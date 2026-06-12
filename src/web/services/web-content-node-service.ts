export type WebContentNode = {
  libp2p?: unknown;
};

type NodeFactory = () => Promise<WebContentNode>;

async function defaultNodeFactory(): Promise<WebContentNode> {
  const { createHelia } = await import('helia');
  const node = await createHelia();
  return node as unknown as WebContentNode;
}

/**
 * Lazy Helia/libp2p bootstrap for the browser content layer.
 *
 * We intentionally do not initialize this during first paint. The node is
 * created on first content-layer use only.
 */
export class WebContentNodeService {
  private readonly factory: NodeFactory;
  private node: WebContentNode | null = null;
  private nodePromise: Promise<WebContentNode> | null = null;

  constructor(factory: NodeFactory = defaultNodeFactory) {
    this.factory = factory;
  }

  hasInitialized(): boolean {
    return this.node !== null;
  }

  async ensureNode(): Promise<WebContentNode> {
    if (this.node) return this.node;
    if (!this.nodePromise) {
      this.nodePromise = this.factory()
        .then((node) => {
          this.node = node;
          return node;
        })
        .catch((error) => {
          this.nodePromise = null;
          throw error;
        });
    }
    return this.nodePromise;
  }

  async ensureLibp2p(): Promise<unknown> {
    const node = await this.ensureNode();
    return node.libp2p;
  }
}
