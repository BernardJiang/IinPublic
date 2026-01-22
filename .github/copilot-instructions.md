<!-- IinPublic Location-Based Chatbot System Instructions -->

## Project Overview
IinPublic is a decentralized, location-based chatbot communication and matching system built with:
- **Web**: TypeScript + Node.js + Gun.js for real-time P2P data
- **Android**: Native app with embedded Node.js-like runtime
- **Core Features**: Location-based chatrooms, structured Q&A talks, chatbot automation, reputation system, bulk matching, surveys

## Development Guidelines

### Architecture Principles
- Decentralized: Gun.js for peer-to-peer real-time data synchronization
- Location-aware: GPS integration with privacy (blurred regions)
- Chat-first: One-on-one conversations with chatbot participation
- Talk-driven: Structured Q&A flows for matching and surveys
- Reputation-based: Community-driven moderation and trust

### Key Components
1. **Chatroom System**: Hierarchical location-based rooms with automatic splitting
2. **Talk Engine**: DAG-structured Q&A flows with branching logic
3. **Chatbot System**: Auto-answer reuse with visual distinction
4. **Reputation System**: Read-only metrics based on community feedback
5. **Tag System**: Craigslist-style categorization for filtering
6. **Survey System**: Statistical aggregation of talk responses
7. **Location Services**: Privacy-preserving GPS with region blurring

### Technical Requirements
- **No loops** in talk structures (DAG enforcement)
- **Auto-linear capture** from chat conversations
- **Mandatory preamble** with tags/location filters
- **Cross-platform consistency** between web and Android
- **Offline capability** with sync when reconnected
- **Performance**: Support 1000 concurrent conversations per user

### Testing Strategy
- Unit tests for core logic (talk validation, filters, reputation)
- Integration tests for Gun.js P2P communication
- Platform-specific tests for web browsers and Android devices
- Performance tests for bulk sending and concurrent conversations
- Security tests for location privacy and data protection

### Code Organization
- Shared core logic between web and Android
- Platform-specific UI and native integrations
- Modular architecture for easy testing and maintenance
- Clean separation between business logic and data persistence

## Current Development Phase
Following systematic workspace setup for full-stack development with comprehensive testing infrastructure.