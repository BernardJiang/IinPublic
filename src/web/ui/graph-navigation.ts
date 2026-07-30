/**
 * The GUI is a graph, not a set of disconnected tabs (docs/TODO.md §Q). `navigateToGraphNode`
 * is the single dispatcher every click-to-traverse handler routes through, instead of each
 * surface inventing its own bespoke jump logic. Grow this union as new edges land (Talk, Q&A)
 * rather than pre-declaring branches nothing calls yet.
 */
export type GraphNodeTarget =
  | { type: 'chatroom'; id: string }
  | { type: 'conversation'; id: string; threadTalkId?: string }
  | { type: 'person'; id: string; name: string };
