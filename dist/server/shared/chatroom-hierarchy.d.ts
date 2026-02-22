/**
 * Chatroom hierarchy definition
 * Tree structure: Global → Continents → Countries
 */
export interface ChatroomNode {
    id: string;
    name: string;
    icon: string;
    description: string;
    children?: ChatroomNode[];
}
/**
 * Hierarchical chatroom structure
 * Global (root) → Continents → Countries (2 per continent for now)
 */
export declare const CHATROOM_HIERARCHY: ChatroomNode;
/**
 * Flatten the tree structure into a list of all chatroom IDs
 * Useful for subscribing to all chatrooms
 */
export declare function getAllChatroomIds(): string[];
/**
 * Get a flat list of all chatroom nodes with their level in the hierarchy
 */
export interface FlatChatroomNode {
    id: string;
    name: string;
    icon: string;
    description: string;
    level: number;
    parentId?: string;
    hasChildren: boolean;
}
export declare function getFlatChatroomList(): FlatChatroomNode[];
//# sourceMappingURL=chatroom-hierarchy.d.ts.map