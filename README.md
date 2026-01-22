# IinPublic - Location-Based Chatbot System

IinPublic is a decentralized location-based chatbot platform that allows real-time communication through chatrooms, interactive talks, and community engagement features.

## Overview

IinPublic provides:
- **Decentralized Real-time Chat**: Using Gun.js for peer-to-peer communication
- **Location-Based Chatrooms**: GPS-enabled chatrooms with privacy controls  
- **Interactive Talks**: Structured Q&A sessions with community moderation
- **Survey System**: Community polls and feedback collection
- **Reputation Engine**: User scoring based on community engagement
- **Cross-Platform Support**: Web application and Android mobile app

## Technology Stack

### Web Platform
- **Frontend**: TypeScript, Webpack 5, HTML5/CSS3
- **Real-time Data**: Gun.js (decentralized database)
- **Build Tools**: Webpack Dev Server, TypeScript compiler
- **Testing**: Jest with ts-jest, Playwright for E2E

### Server Platform  
- **Backend**: Node.js, Express.js, TypeScript
- **Real-time Communication**: Socket.io, Gun.js
- **API**: RESTful endpoints with WebSocket support
- **Security**: Helmet, CORS, input validation

### Android Platform
- **Language**: Kotlin with Java compatibility
- **Build System**: Gradle with Android Gradle Plugin 8.0+
- **Target SDK**: Android 14 (API 34)
- **Minimum SDK**: Android 7.0 (API 24)

## Quick Start

### Prerequisites
- Node.js 18+ and npm
- Android Studio (for mobile development)
- Git

### Installation

1. **Clone and setup**:
   ```powershell
   git clone <your-repo-url>
   cd iin
   npm install
   ```

2. **Development Commands**:
   ```powershell
   # Start web development server (port 3001)
   npm run dev:web
   
   # Start backend server 
   npm run dev:server
   
   # Start both web and server concurrently
   npm run dev
   ```

3. **Build Commands**:
   ```powershell
   # Build web application
   npm run build:web
   
   # Build server application  
   npm run build:server
   
   # Build all platforms
   npm run build
   ```

## Testing & Quality Assurance

IinPublic has a comprehensive test suite and quality assurance pipeline:

### Test Commands
```powershell
# Run all tests
npm test

# Run unit tests only
npm run test:unit

# Run integration tests only  
npm run test:integration

# Run tests in watch mode (for development)
npm run test:watch

# Generate test coverage report
npm run test:coverage

# Run TypeScript type checking
npm run test:type

# Run full test suite with type checking and coverage
npm run test:all
```

### Test Structure
- **Unit Tests**: `src/test/unit/` - Test individual functions and classes
- **Integration Tests**: `src/test/integration/` - Test service interactions  
- **Test Setup**: `src/test/setup.ts` - Global mocks and test configuration

### Code Quality
```powershell
# Run ESLint for code quality
npm run lint

# Fix ESLint issues automatically
npm run lint:fix

# Format code with Prettier
npm run format
```

### Coverage Reports
After running `npm run test:coverage`, view detailed reports:
- **Terminal**: Summary displayed in console
- **HTML Report**: Open `coverage/index.html` in browser
- **LCOV**: `coverage/lcov.info` for CI integration

## Continuous Integration

The project includes automated CI/CD pipeline with GitHub Actions:

### Automated Checks
- ✅ **Type Safety**: TypeScript compilation and type checking
- ✅ **Unit Testing**: Jest-based test suite with coverage
- ✅ **Integration Testing**: Service interaction validation
- ✅ **Code Quality**: ESLint and Prettier formatting checks
- ✅ **Security Scanning**: Dependency audit and CodeQL analysis
- ✅ **Build Verification**: Multi-platform build validation

### Test Results
All tests currently pass with:
- **TypeScript Compilation**: ✅ No errors
- **Web Build**: ✅ Successful (1 minor Gun.js warning)
- **Server Build**: ✅ Successful  
- **Test Coverage**: Comprehensive coverage for core modules

### Recent Fixes
Fixed 18 TypeScript compilation errors including:
- ✅ Unused imports and variables
- ✅ Property initialization issues
- ✅ Type safety with `exactOptionalPropertyTypes`
- ✅ Null safety checks
- ✅ Optional property handling

2. **Start web development**:
   ```powershell
   npm run dev:web
   ```
   Opens web app at http://localhost:3000

3. **Start server** (in new terminal):
   ```powershell
   npm run dev:server
   ```
   Server runs at http://localhost:8080

4. **Build Android** (requires Android Studio):
   ```powershell
   npm run build:android
   ```

## Development Commands

### Web Application
```powershell
npm run dev:web          # Start webpack dev server
npm run build:web        # Production build
npm run serve:web        # Serve production build
```

### Node.js Server
```powershell
npm run dev:server       # Start with nodemon
npm run build:server     # Compile TypeScript
npm run start:server     # Run compiled server
```

### Android Application
```powershell
npm run build:android    # Build APK
npm run test:android     # Run Android tests
```

### Testing
```powershell
npm test                 # Run all tests
npm run test:watch       # Watch mode testing
npm run test:coverage    # Generate coverage report
npm run test:e2e         # End-to-end tests
```

## Project Structure

```
iin/
├── src/
│   ├── shared/           # Shared TypeScript modules
│   │   ├── types.ts      # Core type definitions
│   │   ├── config.ts     # Configuration constants
│   │   ├── errors.ts     # Error handling
│   │   ├── location.ts   # GPS services
│   │   ├── reputation.ts # User scoring system
│   │   └── talk-engine.ts # Talk validation logic
│   ├── web/              # Web frontend
│   │   ├── services/     # Data layer services
│   │   ├── ui/           # UI management
│   │   └── main.ts       # Application entry
│   ├── server/           # Node.js backend
│   │   ├── services/     # Business logic
│   │   └── server.ts     # Express server
│   └── android/          # Android application
│       ├── app/          # Main app module
│       └── gradle/       # Build configuration
├── tests/                # Test suites
├── public/               # Static web assets
└── dist/                 # Compiled output
```

## Core Features

### Chatrooms
- Location-based room discovery
- Real-time messaging via Gun.js
- Privacy controls for location sharing
- Tag-based categorization

### Talks System
- Interactive Q&A sessions
- DAG-based question validation
- Linear and random capture modes
- Community moderation features

### Chatbots
- Automated conversation flows
- Survey collection and analysis
- Integration with reputation system
- Customizable response templates

### Location Services
- GPS integration with privacy controls
- Geofenced chatroom boundaries
- Location-based user discovery
- Privacy-first distance calculations

### Reputation Engine
- Activity-based scoring
- Community validation
- Anti-spam protection
- Transparent scoring metrics

## Configuration

Key configuration files:
- [package.json](package.json) - Dependencies and scripts
- [tsconfig.json](tsconfig.json) - TypeScript compiler settings
- [webpack.config.js](webpack.config.js) - Build configuration
- [jest.config.js](jest.config.js) - Testing setup
- [android/app/build.gradle](android/app/build.gradle) - Android build

### Environment Variables

Create `.env` file for configuration:
```
NODE_ENV=development
WEB_PORT=3000
SERVER_PORT=8080
GUN_PORT=8765
ANDROID_DEBUG=true
```

## Testing Strategy

- **Unit Tests**: 80% coverage target using Jest
- **Integration Tests**: Service layer and API endpoints
- **E2E Tests**: Full user workflows with Playwright
- **Mobile Tests**: Android instrumented and unit tests

Run tests with:
```powershell
npm test                 # All tests
npm run test:unit        # Unit tests only
npm run test:integration # Integration tests
npm run test:e2e         # End-to-end tests
```

## Deployment

### Web Application
```powershell
npm run build:web
# Deploy dist/web/ to your web server
```

### Server Application  
```powershell
npm run build:server
# Deploy dist/server/ to your Node.js host
```

### Android Application
```powershell
npm run build:android
# Generated APK in android/app/build/outputs/apk/
```

## Development Workflow

1. **Start development servers**:
   ```powershell
   npm run dev:web     # Terminal 1
   npm run dev:server  # Terminal 2
   ```

2. **Make changes** to TypeScript files in `src/`

3. **Hot reload** automatically updates web application

4. **Run tests** to verify changes:
   ```powershell
   npm test
   ```

5. **Build for production** when ready:
   ```powershell
   npm run build:web
   npm run build:server
   npm run build:android
   ```

## Troubleshooting

### Common Issues

**TypeScript compilation errors**:
- Ensure all dependencies installed: `npm install`
- Check tsconfig.json for strict settings
- Verify import paths in shared modules

**Gun.js connection issues**:
- Check that Gun peer is running on correct port
- Verify WebSocket connections aren't blocked
- Test with Gun.js debugging enabled

**Android build failures**:
- Update Android Studio and SDK tools
- Clean gradle cache: `./gradlew clean`
- Check minimum SDK requirements

**Port conflicts**:
- Web dev server: Change WEB_PORT in .env
- Node.js server: Change SERVER_PORT in .env  
- Gun.js peer: Change GUN_PORT in .env

### Getting Help

- Check [troubleshooting guide](docs/troubleshooting.md)
- Review test output for specific errors
- Enable debug logging in development mode

## Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature/name`
3. Make changes with tests
4. Run full test suite: `npm test`
5. Submit pull request

## License

[Add your license information here]

---

## Architecture Notes

### Gun.js Integration
- Decentralized real-time database
- Peer-to-peer data synchronization
- Offline-first architecture
- Cryptographic data integrity

### Type Safety
- Strict TypeScript configuration
- Shared type definitions across platforms
- Compile-time error detection
- Runtime type validation where needed

### Security Considerations
- Location privacy by design
- Input sanitization and validation
- Rate limiting for API endpoints
- HTTPS/WSS in production

### Performance
- Lazy loading for large datasets
- Efficient real-time updates
- Optimized bundle sizes
- Mobile-first responsive design