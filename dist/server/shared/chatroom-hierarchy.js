"use strict";
/**
 * Chatroom hierarchy definition
 * Tree structure: Global → Continents → Countries
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHATROOM_HIERARCHY = void 0;
exports.getAllChatroomIds = getAllChatroomIds;
exports.getFlatChatroomList = getFlatChatroomList;
/**
 * Hierarchical chatroom structure
 * Global (root) → Continents → Countries (2 per continent for now)
 */
exports.CHATROOM_HIERARCHY = {
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
function getAllChatroomIds() {
    const ids = [];
    function traverse(node) {
        ids.push(node.id);
        if (node.children) {
            node.children.forEach((child) => traverse(child));
        }
    }
    traverse(exports.CHATROOM_HIERARCHY);
    return ids;
}
function getFlatChatroomList() {
    const flatList = [];
    function traverse(node, level, parentId) {
        const chatroomNode = {
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
    traverse(exports.CHATROOM_HIERARCHY, 0);
    return flatList;
}
//# sourceMappingURL=chatroom-hierarchy.js.map