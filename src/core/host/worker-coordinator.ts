/** One storage owner per origin, including the dedicated-worker fallback.
 * Web Locks transfers ownership only after the previous worker dies; heartbeats never grant it.
 * BroadcastChannel routes requests to that owner. Each page has its own reply/subscription session.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface CoreWorkerHost {
  receive(client: string, message: any, emit: (message: any) => void): Promise<void>;
  disconnect(client: string): void;
}

export function coordinateWorker(scope: any, host: CoreWorkerHost): void {
  const workerId = crypto.randomUUID();
  const local = new Map<string, (message: any) => void>();
  const reconnecting = new Set<string>();
  const queued: Array<{ client: string; message: any }> = [];
  const shared = 'onconnect' in scope;
  const isolated = new URL(scope.location.href).searchParams.get('isolated') === '1';
  const locks: LockManager | undefined = scope.navigator?.locks;
  const channel = !isolated && typeof BroadcastChannel !== 'undefined'
    ? new BroadcastChannel('iinpublic-device-core-v1') : null;
  let owner: string | null = null;
  let leader = false;

  const emit = (client: string, message: any): void => {
    const send = local.get(client);
    if (send) send(message);
    else channel?.postMessage({ kind: 'reply', owner: workerId, client, message });
  };
  const receive = (client: string, message: any): void => {
    if (message.type === 'disconnect') { host.disconnect(client); return; }
    void host.receive(client, message, (answer) => emit(client, answer));
  };
  const route = (client: string, message: any): void => {
    if (reconnecting.has(client)) {
      if (message.type === 'init') reconnecting.delete(client);
      else if (message.type !== 'disconnect') {
        local.get(client)?.({ id: message.id, err: 'Device core owner changed; session is reconnecting' });
        return;
      }
    }
    if (!owner) queued.push({ client, message });
    else if (leader) receive(client, message);
    else channel?.postMessage({ kind: 'request', owner, client, message });
  };
  const announce = (id: string): void => {
    if (owner === id) return;
    const replaced = owner !== null;
    owner = id;
    if (replaced) {
      // Do not retry ambiguous writes. The bridge rejects them and reconnects its session;
      // acknowledged data is read from storage, and the app retains unconfirmed local edits.
      for (const [client, send] of local) { reconnecting.add(client); send({ type: 'core-reset' }); }
    }
    for (const request of queued.splice(0)) route(request.client, request.message);
  };
  if (channel) channel.onmessage = ({ data }: MessageEvent) => {
    if (data.kind === 'discover' && leader) channel.postMessage({ kind: 'owner', owner: workerId });
    if (data.kind === 'owner' && !leader) announce(data.owner);
    if (data.kind === 'request' && leader && data.owner === workerId) receive(data.client, data.message);
    if (data.kind === 'reply' && data.owner === owner) local.get(data.client)?.(data.message);
  };

  const attach = (port: any): void => {
    const client = `${workerId}:${crypto.randomUUID()}`;
    local.set(client, (message) => port.postMessage(message));
    port.onmessage = ({ data }: MessageEvent) => {
      route(client, data);
      if (data?.type === 'disconnect') {
        local.delete(client);
        reconnecting.delete(client);
        port.close?.();
      }
    };
    port.start?.();
    port.postMessage({ type: 'core-session', session: client });
    channel?.postMessage({ kind: 'discover' });
  };
  if (shared) scope.onconnect = (event: MessageEvent) => attach(event.ports[0]);
  else attach(scope);

  const own = (): void => {
    leader = true;
    announce(workerId);
    channel?.postMessage({ kind: 'owner', owner: workerId });
  };
  if (isolated || (shared && !locks)) own();
  else if (locks && channel) {
    void locks.request('iinpublic-device-core-storage', async () => {
      own();
      await new Promise<void>(() => {}); // released by the browser when this worker terminates
    }).catch((error) => {
      for (const send of local.values()) send({ type: 'core-error', error: String(error) });
    });
    // Handles a newly created worker whose first discovery ran before the owner started listening.
    const discovery = setInterval(() => {
      if (owner) clearInterval(discovery);
      else channel.postMessage({ kind: 'discover' });
    }, 250);
  } else {
    // Never start a second uncoordinated IndexedDB writer on an unsupported browser.
    scope.onmessage = ({ data }: MessageEvent) => scope.postMessage({ id: data.id, err: 'SharedWorker or Web Locks is required for safe device storage' });
  }
}
