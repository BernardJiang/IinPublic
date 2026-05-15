/**
 * Chatroom hierarchy definition
 * Tree structure: Global → Continents → Countries → State/region
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
 * Global (root) → Continents → Countries → representative state/region rooms
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
          children: [
            {
              id: 'california',
              name: 'California',
              icon: '🌉',
              description: 'California regional chatroom',
            },
            {
              id: 'new-york-state',
              name: 'New York',
              icon: '🗽',
              description: 'New York regional chatroom',
            },
            {
              id: 'texas',
              name: 'Texas',
              icon: '⭐',
              description: 'Texas regional chatroom',
            },
          ],
        },
        {
          id: 'canada',
          name: 'Canada',
          icon: '🇨🇦',
          description: 'Canada chatroom',
          children: [
            {
              id: 'ontario',
              name: 'Ontario',
              icon: '🍁',
              description: 'Ontario regional chatroom',
            },
            {
              id: 'british-columbia',
              name: 'British Columbia',
              icon: '🏔️',
              description: 'British Columbia regional chatroom',
            },
          ],
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
          children: [
            {
              id: 'sao-paulo-state',
              name: 'Sao Paulo',
              icon: '🏙️',
              description: 'Sao Paulo regional chatroom',
            },
            {
              id: 'rio-de-janeiro-state',
              name: 'Rio de Janeiro',
              icon: '🏖️',
              description: 'Rio de Janeiro regional chatroom',
            },
          ],
        },
        {
          id: 'argentina',
          name: 'Argentina',
          icon: '🇦🇷',
          description: 'Argentina chatroom',
          children: [
            {
              id: 'buenos-aires-province',
              name: 'Buenos Aires',
              icon: '🏙️',
              description: 'Buenos Aires regional chatroom',
            },
          ],
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
          children: [
            {
              id: 'england',
              name: 'England',
              icon: '🏙️',
              description: 'England regional chatroom',
            },
            {
              id: 'scotland',
              name: 'Scotland',
              icon: '🏔️',
              description: 'Scotland regional chatroom',
            },
          ],
        },
        {
          id: 'germany',
          name: 'Germany',
          icon: '🇩🇪',
          description: 'Germany chatroom',
          children: [
            {
              id: 'bavaria',
              name: 'Bavaria',
              icon: '🏔️',
              description: 'Bavaria regional chatroom',
            },
            {
              id: 'berlin-state',
              name: 'Berlin',
              icon: '🏙️',
              description: 'Berlin regional chatroom',
            },
          ],
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
          children: [
            {
              id: 'guangdong',
              name: 'Guangdong',
              icon: '🏙️',
              description: 'Guangdong regional chatroom',
            },
            {
              id: 'beijing-municipality',
              name: 'Beijing',
              icon: '🏛️',
              description: 'Beijing regional chatroom',
            },
          ],
        },
        {
          id: 'japan',
          name: 'Japan',
          icon: '🇯🇵',
          description: 'Japan chatroom',
          children: [
            {
              id: 'tokyo-metropolis',
              name: 'Tokyo',
              icon: '🏙️',
              description: 'Tokyo regional chatroom',
            },
            {
              id: 'kansai',
              name: 'Kansai',
              icon: '⛩️',
              description: 'Kansai regional chatroom',
            },
          ],
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
          children: [
            {
              id: 'lagos-state',
              name: 'Lagos',
              icon: '🏙️',
              description: 'Lagos regional chatroom',
            },
          ],
        },
        {
          id: 'south-africa',
          name: 'South Africa',
          icon: '🇿🇦',
          description: 'South Africa chatroom',
          children: [
            {
              id: 'western-cape',
              name: 'Western Cape',
              icon: '⛰️',
              description: 'Western Cape regional chatroom',
            },
            {
              id: 'gauteng',
              name: 'Gauteng',
              icon: '🏙️',
              description: 'Gauteng regional chatroom',
            },
          ],
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
          children: [
            {
              id: 'new-south-wales',
              name: 'New South Wales',
              icon: '🌉',
              description: 'New South Wales regional chatroom',
            },
            {
              id: 'victoria-au',
              name: 'Victoria',
              icon: '🏙️',
              description: 'Victoria regional chatroom',
            },
          ],
        },
        {
          id: 'new-zealand',
          name: 'New Zealand',
          icon: '🇳🇿',
          description: 'New Zealand chatroom',
          children: [
            {
              id: 'auckland-region',
              name: 'Auckland',
              icon: '🌋',
              description: 'Auckland regional chatroom',
            },
          ],
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
