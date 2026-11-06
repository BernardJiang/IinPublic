/** @jest-environment node */
import { memoryNodeStore } from '../../../core/device-graph/node-store';
import { createDeviceGraph } from '../../../core/device-graph/device-graph';
it('reads a Talk whose answers have no ids', async () => {
  const g = createDeviceGraph(memoryNodeStore(), { randomBytes: (n) => Uint8Array.from({ length: n }, (_, i) => i + 7) });
  const id = await g.talks.create({ title: 'T', type: 'tag', questions: [{ id: 'q1', text: 'Do you like mesh?', answers: [{ text: 'Yes' }, { text: 'No' }] }] } as any);
  const back = await g.talks.read(id);
  console.log(JSON.stringify(back?.questions));
  expect(back).toBeTruthy();
});
