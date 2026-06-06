/**
 * Chatroom hierarchy definition
 * Tree structure: Global → Continents → Countries → State/region
 */
import { computeCIDv1Sync } from './cid';
import type { CommunityRole } from './types';

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
              children: [
                {
                  id: 'san-diego',
                  name: 'San Diego',
                  icon: '🌊',
                  description: 'San Diego city chatroom',
                },
                {
                  id: 'los-angeles',
                  name: 'Los Angeles',
                  icon: '🎬',
                  description: 'Los Angeles city chatroom',
                },
              ],
            },
            {
              id: 'new-york-state',
              name: 'New York',
              icon: '🗽',
              description: 'New York regional chatroom',
              children: [
                {
                  id: 'new-york-city',
                  name: 'New York City',
                  icon: '🏙️',
                  description: 'New York City chatroom',
                },
                {
                  id: 'buffalo',
                  name: 'Buffalo',
                  icon: '❄️',
                  description: 'Buffalo city chatroom',
                },
              ],
            },
            {
              id: 'texas',
              name: 'Texas',
              icon: '⭐',
              description: 'Texas regional chatroom',
              children: [
                {
                  id: 'austin',
                  name: 'Austin',
                  icon: '🎸',
                  description: 'Austin city chatroom',
                },
                {
                  id: 'houston',
                  name: 'Houston',
                  icon: '🚀',
                  description: 'Houston city chatroom',
                },
              ],
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
              children: [
                {
                  id: 'toronto',
                  name: 'Toronto',
                  icon: '🏙️',
                  description: 'Toronto city chatroom',
                },
                {
                  id: 'ottawa',
                  name: 'Ottawa',
                  icon: '🏛️',
                  description: 'Ottawa city chatroom',
                },
              ],
            },
            {
              id: 'british-columbia',
              name: 'British Columbia',
              icon: '🏔️',
              description: 'British Columbia regional chatroom',
              children: [
                {
                  id: 'vancouver',
                  name: 'Vancouver',
                  icon: '🌲',
                  description: 'Vancouver city chatroom',
                },
                {
                  id: 'victoria-bc',
                  name: 'Victoria',
                  icon: '🌊',
                  description: 'Victoria city chatroom',
                },
              ],
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
              children: [
                {
                  id: 'sao-paulo-city',
                  name: 'Sao Paulo',
                  icon: '🏙️',
                  description: 'Sao Paulo city chatroom',
                },
                {
                  id: 'campinas',
                  name: 'Campinas',
                  icon: '🌳',
                  description: 'Campinas city chatroom',
                },
              ],
            },
            {
              id: 'rio-de-janeiro-state',
              name: 'Rio de Janeiro',
              icon: '🏖️',
              description: 'Rio de Janeiro regional chatroom',
              children: [
                {
                  id: 'rio-de-janeiro-city',
                  name: 'Rio de Janeiro',
                  icon: '🏖️',
                  description: 'Rio de Janeiro city chatroom',
                },
                {
                  id: 'niteroi',
                  name: 'Niteroi',
                  icon: '🌉',
                  description: 'Niteroi city chatroom',
                },
              ],
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
              children: [
                {
                  id: 'buenos-aires-city',
                  name: 'Buenos Aires',
                  icon: '🏙️',
                  description: 'Buenos Aires city chatroom',
                },
                {
                  id: 'la-plata',
                  name: 'La Plata',
                  icon: '🌳',
                  description: 'La Plata city chatroom',
                },
              ],
            },
            {
              id: 'cordoba-province',
              name: 'Cordoba',
              icon: '⛰️',
              description: 'Cordoba regional chatroom',
              children: [
                {
                  id: 'cordoba-city',
                  name: 'Cordoba',
                  icon: '⛰️',
                  description: 'Cordoba city chatroom',
                },
                {
                  id: 'villa-carlos-paz',
                  name: 'Villa Carlos Paz',
                  icon: '🌊',
                  description: 'Villa Carlos Paz city chatroom',
                },
              ],
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
              children: [
                {
                  id: 'london',
                  name: 'London',
                  icon: '🏙️',
                  description: 'London city chatroom',
                },
                {
                  id: 'manchester',
                  name: 'Manchester',
                  icon: '🎵',
                  description: 'Manchester city chatroom',
                },
              ],
            },
            {
              id: 'scotland',
              name: 'Scotland',
              icon: '🏔️',
              description: 'Scotland regional chatroom',
              children: [
                {
                  id: 'edinburgh',
                  name: 'Edinburgh',
                  icon: '🏰',
                  description: 'Edinburgh city chatroom',
                },
                {
                  id: 'glasgow',
                  name: 'Glasgow',
                  icon: '🎭',
                  description: 'Glasgow city chatroom',
                },
              ],
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
              children: [
                {
                  id: 'munich',
                  name: 'Munich',
                  icon: '🏛️',
                  description: 'Munich city chatroom',
                },
                {
                  id: 'nuremberg',
                  name: 'Nuremberg',
                  icon: '🏰',
                  description: 'Nuremberg city chatroom',
                },
              ],
            },
            {
              id: 'berlin-state',
              name: 'Berlin',
              icon: '🏙️',
              description: 'Berlin regional chatroom',
              children: [
                {
                  id: 'berlin-city',
                  name: 'Berlin',
                  icon: '🏙️',
                  description: 'Berlin city chatroom',
                },
                {
                  id: 'potsdam',
                  name: 'Potsdam',
                  icon: '🌳',
                  description: 'Potsdam city chatroom',
                },
              ],
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
              children: [
                {
                  id: 'guangzhou',
                  name: 'Guangzhou',
                  icon: '🏙️',
                  description: 'Guangzhou city chatroom',
                },
                {
                  id: 'shenzhen',
                  name: 'Shenzhen',
                  icon: '🌆',
                  description: 'Shenzhen city chatroom',
                },
              ],
            },
            {
              id: 'beijing-municipality',
              name: 'Beijing',
              icon: '🏛️',
              description: 'Beijing regional chatroom',
              children: [
                {
                  id: 'beijing-city',
                  name: 'Beijing',
                  icon: '🏛️',
                  description: 'Beijing city chatroom',
                },
                {
                  id: 'tongzhou',
                  name: 'Tongzhou',
                  icon: '🌉',
                  description: 'Tongzhou city chatroom',
                },
              ],
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
              children: [
                {
                  id: 'tokyo-city',
                  name: 'Tokyo',
                  icon: '🏙️',
                  description: 'Tokyo city chatroom',
                },
                {
                  id: 'hachioji',
                  name: 'Hachioji',
                  icon: '🌳',
                  description: 'Hachioji city chatroom',
                },
              ],
            },
            {
              id: 'kansai',
              name: 'Kansai',
              icon: '⛩️',
              description: 'Kansai regional chatroom',
              children: [
                {
                  id: 'osaka',
                  name: 'Osaka',
                  icon: '🏙️',
                  description: 'Osaka city chatroom',
                },
                {
                  id: 'kyoto',
                  name: 'Kyoto',
                  icon: '⛩️',
                  description: 'Kyoto city chatroom',
                },
              ],
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
              children: [
                {
                  id: 'lagos-city',
                  name: 'Lagos',
                  icon: '🏙️',
                  description: 'Lagos city chatroom',
                },
                {
                  id: 'ikeja',
                  name: 'Ikeja',
                  icon: '🏛️',
                  description: 'Ikeja city chatroom',
                },
              ],
            },
            {
              id: 'federal-capital-territory',
              name: 'Federal Capital Territory',
              icon: '🏛️',
              description: 'Federal Capital Territory regional chatroom',
              children: [
                {
                  id: 'abuja',
                  name: 'Abuja',
                  icon: '🏛️',
                  description: 'Abuja city chatroom',
                },
                {
                  id: 'gwagwalada',
                  name: 'Gwagwalada',
                  icon: '🌳',
                  description: 'Gwagwalada city chatroom',
                },
              ],
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
              children: [
                {
                  id: 'cape-town',
                  name: 'Cape Town',
                  icon: '⛰️',
                  description: 'Cape Town city chatroom',
                },
                {
                  id: 'stellenbosch',
                  name: 'Stellenbosch',
                  icon: '🍇',
                  description: 'Stellenbosch city chatroom',
                },
              ],
            },
            {
              id: 'gauteng',
              name: 'Gauteng',
              icon: '🏙️',
              description: 'Gauteng regional chatroom',
              children: [
                {
                  id: 'johannesburg',
                  name: 'Johannesburg',
                  icon: '🏙️',
                  description: 'Johannesburg city chatroom',
                },
                {
                  id: 'pretoria',
                  name: 'Pretoria',
                  icon: '🏛️',
                  description: 'Pretoria city chatroom',
                },
              ],
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
              children: [
                {
                  id: 'sydney',
                  name: 'Sydney',
                  icon: '🌉',
                  description: 'Sydney city chatroom',
                },
                {
                  id: 'newcastle-au',
                  name: 'Newcastle',
                  icon: '⚓',
                  description: 'Newcastle city chatroom',
                },
              ],
            },
            {
              id: 'victoria-au',
              name: 'Victoria',
              icon: '🏙️',
              description: 'Victoria regional chatroom',
              children: [
                {
                  id: 'melbourne',
                  name: 'Melbourne',
                  icon: '🏙️',
                  description: 'Melbourne city chatroom',
                },
                {
                  id: 'geelong',
                  name: 'Geelong',
                  icon: '🌊',
                  description: 'Geelong city chatroom',
                },
              ],
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
              children: [
                {
                  id: 'auckland-city',
                  name: 'Auckland',
                  icon: '🌋',
                  description: 'Auckland city chatroom',
                },
                {
                  id: 'manukau',
                  name: 'Manukau',
                  icon: '🌊',
                  description: 'Manukau city chatroom',
                },
              ],
            },
            {
              id: 'wellington-region',
              name: 'Wellington',
              icon: '🌬️',
              description: 'Wellington regional chatroom',
              children: [
                {
                  id: 'wellington-city',
                  name: 'Wellington',
                  icon: '🌬️',
                  description: 'Wellington city chatroom',
                },
                {
                  id: 'lower-hutt',
                  name: 'Lower Hutt',
                  icon: '🌳',
                  description: 'Lower Hutt city chatroom',
                },
              ],
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

// ─── Content-addressed community IDs (FR-CR-11) ──────────────────────────────

/**
 * Derive a stable, self-certifying community ID for a user-defined chatroom.
 *
 * The ID is a CIDv1 (dag-json, sha2-256) of { ownerPub, label } — identical
 * inputs always produce the same ID, different inputs never collide.
 * This means a community address alone is sufficient to join, discover peers,
 * and synchronise content without a centralised registry lookup.
 *
 * Spec: FR-CR-11 (SRS v4.5 §3.3)
 *
 * @param ownerPub  The SEA public key of the room creator (hex or base64url).
 * @param label     A short human-readable room label chosen by the creator.
 *                  Normalised to lower-case + trimmed before hashing.
 */
export function deriveCommunityId(ownerPub: string, label: string): string {
  const normalised = label.trim().toLowerCase();
  return computeCIDv1Sync({ ownerPub, label: normalised });
}

// ─── Community role helpers (FR-CR-12) ───────────────────────────────────────

/**
 * Permission matrix: what each role level is allowed to do.
 * Actions not listed default to false.
 */
export interface RoleCapabilities {
  /** May post messages into the chatroom */
  canPost: boolean;
  /** May broadcast a talk to chatroom members */
  canBroadcast: boolean;
  /** May change member ↔ guest roles */
  canManageMembers: boolean;
  /** May change moderator roles (and below) */
  canManageModerators: boolean;
  /** May transfer ownership or delete the room */
  canManageRoom: boolean;
}

const ROLE_CAPABILITIES: Record<CommunityRole, RoleCapabilities> = {
  owner: {
    canPost: true,
    canBroadcast: true,
    canManageMembers: true,
    canManageModerators: true,
    canManageRoom: true,
  },
  moderator: {
    canPost: true,
    canBroadcast: true,
    canManageMembers: true,
    canManageModerators: false,
    canManageRoom: false,
  },
  member: {
    canPost: true,
    canBroadcast: true,
    canManageMembers: false,
    canManageModerators: false,
    canManageRoom: false,
  },
  guest: {
    canPost: true,
    canBroadcast: false,   // FR-CR-12: guests blocked from broadcasting by default
    canManageMembers: false,
    canManageModerators: false,
    canManageRoom: false,
  },
};

/** Return the capability matrix for a given role. */
export function getRoleCapabilities(role: CommunityRole): RoleCapabilities {
  return ROLE_CAPABILITIES[role];
}

/**
 * Return true if `actorRole` may assign `targetRole` to another user.
 *
 * Rules:
 *  - owner  → may set any role on any user (except themselves; callers enforce that).
 *  - moderator → may set member or guest only.
 *  - member / guest → no role management.
 */
export function canAssignRole(actorRole: CommunityRole, targetRole: CommunityRole): boolean {
  if (actorRole === 'owner') return true;
  if (actorRole === 'moderator') return targetRole === 'member' || targetRole === 'guest';
  return false;
}

/**
 * Gun path for a user's role record within a chatroom.
 *   chatroomRoles/<chatroomId>/<userId>
 */
export function chatroomRolePath(chatroomId: string, userId: string): string {
  return `chatroomRoles/${chatroomId}/${userId}`;
}
