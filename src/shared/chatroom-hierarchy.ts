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
export const CHATROOM_HIERARCHY: ChatroomNode = {
  id: 'global',
  name: 'Global',
  icon: '🌍',
  description: 'Connect with everyone worldwide',
  children: [
    {
      id: 'north-america',
      name: 'North America',
      icon: '🌎',
      description: 'North American continent',
      children: [
        {
          id: 'usa',
          name: 'United States',
          icon: '🇺🇸',
          description: 'United States chatroom',
        },
        {
          id: 'canada',
          name: 'Canada',
          icon: '🇨🇦',
          description: 'Canada chatroom',
        },
      ],
    },
    {
      id: 'south-america',
      name: 'South America',
      icon: '🌎',
      description: 'South American continent',
      children: [
        {
          id: 'brazil',
          name: 'Brazil',
          icon: '🇧🇷',
          description: 'Brazil chatroom',
        },
        {
          id: 'argentina',
          name: 'Argentina',
          icon: '🇦🇷',
          description: 'Argentina chatroom',
        },
      ],
    },
    {
      id: 'europe',
      name: 'Europe',
      icon: '🇪🇺',
      description: 'European continent',
      children: [
        {
          id: 'uk',
          name: 'United Kingdom',
          icon: '🇬🇧',
          description: 'United Kingdom chatroom',
        },
        {
          id: 'germany',
          name: 'Germany',
          icon: '🇩🇪',
          description: 'Germany chatroom',
        },
      ],
    },
    {
      id: 'asia',
      name: 'Asia',
      icon: '🌏',
      description: 'Asian continent',
      children: [
        {
          id: 'china',
          name: 'China',
          icon: '🇨🇳',
          description: 'China chatroom',
        },
        {
          id: 'japan',
          name: 'Japan',
          icon: '🇯🇵',
          description: 'Japan chatroom',
        },
      ],
    },
    {
      id: 'africa',
      name: 'Africa',
      icon: '🌍',
      description: 'African continent',
      children: [
        {
          id: 'nigeria',
          name: 'Nigeria',
          icon: '🇳🇬',
          description: 'Nigeria chatroom',
        },
        {
          id: 'south-africa',
          name: 'South Africa',
          icon: '🇿🇦',
          description: 'South Africa chatroom',
        },
      ],
    },
    {
      id: 'oceania',
      name: 'Oceania',
      icon: '🌏',
      description: 'Oceania continent',
      children: [
        {
          id: 'australia',
          name: 'Australia',
          icon: '🇦🇺',
          description: 'Australia chatroom',
        },
        {
          id: 'new-zealand',
          name: 'New Zealand',
          icon: '🇳🇿',
          description: 'New Zealand chatroom',
        },
      ],
    },
  ],
};

/**
 * Flatten the tree structure into a list of all chatroom IDs
 * Useful for subscribing to all chatrooms
 */
export function getAllChatroomIds(): string[] {
  const ids: string[] = [];

  function traverse(node: ChatroomNode): void {
    ids.push(node.id);
    if (node.children) {
      node.children.forEach((child) => traverse(child));
    }
  }

  traverse(CHATROOM_HIERARCHY);
  return ids;
}

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

export function getFlatChatroomList(): FlatChatroomNode[] {
  const flatList: FlatChatroomNode[] = [];

  function traverse(node: ChatroomNode, level: number, parentId?: string): void {
    const chatroomNode: FlatChatroomNode = {
      id: node.id,
      name: node.name,
      icon: node.icon,
      description: node.description,
      level,
      hasChildren: !!(node.children && node.children.length > 0),
    };

    // Only add parentId if it's defined
    if (parentId !== undefined) {
      chatroomNode.parentId = parentId;
    }

    flatList.push(chatroomNode);

    if (node.children) {
      node.children.forEach((child) => traverse(child, level + 1, node.id));
    }
  }

  traverse(CHATROOM_HIERARCHY, 0);
  return flatList;
}
