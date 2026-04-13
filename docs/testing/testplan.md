# Test Plan for IinPublic
## Location-Based Chatbot Matching & Talk System

---

## 1. Introduction

### 1.1 Purpose
This test plan defines the testing strategy, scope, and approach for validating the IinPublic application against the requirements specified in the Software Requirements Specification (SRS). It serves as a guide for:
- Test engineers and QA teams
- Developers performing unit and integration testing
- Product owners validating business requirements
- Stakeholders assessing system readiness

### 1.2 Scope
This test plan covers:
- **Functional Testing**: All functional requirements (FR-*) from the SRS
- **Non-Functional Testing**: Performance, security, usability, and portability requirements
- **Platform Testing**: Web (browser + embedded Node.js), Android, and future iOS
- **Integration Testing**: Gun.js integration, location services, real-time communication
- **User Acceptance Testing**: End-to-end user scenarios and workflows

### 1.3 Test Objectives
- Verify all functional requirements are implemented correctly
- Validate system performance under load (up to 1000 concurrent conversations)
- Ensure security and privacy requirements are met
- Confirm cross-platform compatibility and consistency
- Test offline/online synchronization capabilities
- Validate decentralized architecture resilience

---

## 2. Test Strategy

### 2.1 Testing Levels

#### 2.1.1 Unit Testing
- **Scope**: Individual functions, methods, and components
- **Tools**: Jest, Mocha, or similar framework
- **Coverage Target**: 80% code coverage minimum
- **Focus Areas**:
  - Talk structure validation (DAG, no loops)
  - Filter logic (language, grammar, dirty words)
  - Auto-answer vs manual answer handling
  - Tag system functionality
  - Reputation calculations

#### 2.1.2 Integration Testing
- **Scope**: Component interactions, Gun.js integration, API integrations
- **Focus Areas**:
  - Gun.js peer-to-peer communication
  - Location services integration
  - Chat room management
  - Talk execution engine
  - Survey aggregation system

#### 2.1.3 System Testing
- **Scope**: Complete system functionality
- **Environment**: Staging environment mirroring production
- **Focus Areas**:
  - End-to-end user workflows
  - Performance under load
  - Security and privacy
  - Cross-platform consistency

#### 2.1.4 User Acceptance Testing (UAT)
- **Scope**: Business scenarios and user experience validation
- **Participants**: Business stakeholders, representative users
- **Focus Areas**:
  - Business use cases (dating, buying/selling, hobby matching)
  - User interface usability
  - Business chatroom functionality

### 2.2 Testing Types

#### 2.2.1 Functional Testing
- Feature validation against SRS requirements
- Boundary condition testing
- Error handling and validation
- Data integrity verification

#### 2.2.2 Performance Testing
- **Load Testing**: Normal expected load (up to 1000 users per chatroom)
- **Stress Testing**: Beyond normal capacity to find breaking points
- **Volume Testing**: Large amounts of data (talks, messages, user profiles)
- **Scalability Testing**: System behavior as load increases

#### 2.2.3 Security Testing
- Location privacy validation
- User data protection
- Input validation and sanitization
- Authentication and authorization (where applicable)

#### 2.2.4 Compatibility Testing
- **Browser Testing**: Chrome, Firefox, Safari, Edge
- **Mobile Testing**: Various Android devices and versions
- **Network Testing**: Different connection types and speeds

---

## 3. Test Environment

### 3.1 Hardware Requirements
- **Development**: Local development machines with GPS simulation
- **Staging**: Cloud-based environment with multiple nodes
- **Mobile Testing**: Physical Android devices with various OS versions

### 3.2 Software Requirements
- **Web**: Modern browsers, Node.js runtime
- **Android**: Android SDK, emulators, physical devices
- **Backend**: Gun.js nodes, signaling servers
- **Tools**: Test frameworks, automation tools, monitoring solutions

### 3.3 Test Data
- Mock user profiles with various characteristics
- Sample talks for different use cases
- Location data for different geographic regions
- Business profiles for testing business chatrooms

---

## 4. Detailed Test Cases

### 4.1 User Management & Profile Testing

#### TC-UM-001: User ID Assignment
- **Objective**: Verify unique user ID assignment on first use
- **Prerequisites**: Clean application state, no existing user data
- **Steps**:
  1. Launch application for the first time
  2. Verify unique ID is generated automatically
  3. Restart application and verify same ID is retained
- **Expected Results**: Unique ID assigned, persistent across sessions

#### TC-UM-002: StageName Management
- **Objective**: Verify mandatory StageName functionality
- **Steps**:
  1. New user attempts to proceed without setting StageName
  2. Set valid StageName
  3. Attempt to set duplicate StageName (if uniqueness required)
- **Expected Results**: StageName required, validation works correctly

#### TC-UM-003: Profile Q&A System
- **Objective**: Validate profile as question/answer list
- **Steps**:
  1. Answer various questions to build profile
  2. Modify existing answers
  3. View profile from another user's perspective
- **Expected Results**: Profile correctly stores and displays Q&A pairs

#### TC-UM-004: Reputation System
- **Objective**: Verify reputation metrics are read-only and accurate
- **Steps**:
  1. Perform actions that should affect reputation
  2. Attempt to directly modify reputation values
  3. Verify reputation calculations are correct
- **Expected Results**: Reputation updates automatically, cannot be manually edited

### 4.2 Built-in Filters Testing

#### TC-BF-001: Language Filter
- **Objective**: Verify language filtering works correctly
- **Prerequisites**: User configured with specific language preferences
- **Steps**:
  1. Send talks in supported languages
  2. Send talks in unsupported languages
  3. Toggle language filter on/off
- **Expected Results**: Only supported language talks are received when filter is enabled

#### TC-BF-002: Grammar Filter
- **Objective**: Validate grammar error detection and filtering
- **Steps**:
  1. Send talks with correct grammar
  2. Send talks with significant grammar errors
  3. Test various sensitivity levels
- **Expected Results**: Grammar filter correctly identifies and filters poor grammar

#### TC-BF-003: Dirty Words Filter
- **Objective**: Verify offensive content filtering
- **Steps**:
  1. Send talks with offensive terms
  2. Send talks with borderline content
  3. Test filter sensitivity settings
- **Expected Results**: Offensive content is filtered appropriately

### 4.3 Chatroom Management Testing

#### TC-CR-001: Global Chatroom
- **Objective**: Verify global chatroom functionality
- **Steps**:
  1. New user joins application
  2. Verify placement in global chatroom
  3. Test communication within global chatroom
- **Expected Results**: All new users start in global chatroom

#### TC-CR-002: Automatic Room Splitting
- **Objective**: Validate chatroom splitting when capacity exceeded
- **Prerequisites**: Ability to simulate 1000+ users
- **Steps**:
  1. Fill chatroom to capacity threshold
  2. Add additional users
  3. Verify automatic splitting occurs
  4. Test user placement in appropriate subrooms
- **Expected Results**: Rooms split automatically, users moved to appropriate locations

#### TC-CR-003: Business Chatroom Creation
- **Objective**: Verify business chatroom functionality
- **Steps**:
  1. Create business chatroom with required fields
  2. Verify location binding
  3. Test business-specific features
- **Expected Results**: Business chatroom created with all required attributes

#### TC-CR-004: Traveller Functionality
- **Objective**: Test remote chatroom access
- **Steps**:
  1. User travels to remote chatroom
  2. Verify traveller status is marked
  3. Test limitations and capabilities as traveller
- **Expected Results**: Traveller status correctly applied and enforced

### 4.4 Question-Answer System Testing

#### TC-QA-001: Question Format Validation
- **Objective**: Verify question format requirements
- **Steps**:
  1. Create questions ending with "?"
  2. Attempt invalid question formats
  3. Verify validation messages
- **Expected Results**: Only valid question formats accepted

#### TC-QA-002: Answer Options
- **Objective**: Test predefined answer functionality
- **Steps**:
  1. Create questions with various answer types (binary, multiple choice, ranges)
  2. Test "Ignore" option availability
  3. Verify answer selection works correctly
- **Expected Results**: All answer types work, "Ignore" always available

#### TC-QA-003: Auto vs Manual Answers
- **Objective**: Validate auto/manual answer functionality
- **Steps**:
  1. Set answer as "Auto" and test chatbot reuse
  2. Set answer as "Manual" and verify no automatic reuse
  3. Test chatbot icon overlay for auto answers
- **Expected Results**: Auto answers reused by chatbot, manual answers are not

### 4.5 Talk Structure and Execution Testing

#### TC-TK-001: Talk Structure Validation
- **Objective**: Verify DAG structure enforcement (no loops)
- **Steps**:
  1. Create valid tree structure talk
  2. Attempt to create talk with loops
  3. Test logic OR functionality
- **Expected Results**: Valid structures accepted, loops prevented

#### TC-TK-002: Auto Linear Capture
- **Objective**: Test automatic talk capture from chat
- **Prerequisites**: Two users in one-on-one chat
- **Steps**:
  1. User A sends: "Do you like coffee? Yes; No."
  2. User B selects "Yes"
  3. User A sends: "Hot or iced? Hot; Iced."
  4. User B selects "Iced"
  5. User A sends: "Great, let's meet tomorrow." (no answer options)
- **Expected Results**: 
  - Predefined answers appear as selectable chips
  - Linear talk is automatically created and saved as draft
  - Tags/location preamble automatically included

#### TC-TK-003: Talk Editor Functionality
- **Objective**: Validate talk editor capabilities
- **Steps**:
  1. Create tree-structured talk in editor
  2. Create survey talk in editor
  3. Test branching and OR-join functionality
  4. Verify loop prevention
- **Expected Results**: Editor supports all required talk types and structures

### 4.6 Bulk Matching and Sending Testing

#### TC-BM-001: Bulk Send Functionality
- **Objective**: Test bulk sending to multiple recipients
- **Prerequisites**: Target users available in chatroom
- **Steps**:
  1. Create talk with appropriate filters
  2. Send to maximum allowed recipients (1000)
  3. Verify separate conversation instances created
  4. Monitor delivery and response rates
- **Expected Results**: Talk sent to all eligible recipients, separate conversations created

#### TC-BM-002: Tennis Partner Matching (from SRS Example)
- **Objective**: Comprehensive tennis partner matching scenario
- **Prerequisites**: Users with tennis interest in city chatroom
- **Steps**:
  1. Create tennis partner talk with skill level filtering
  2. Bulk send to users with "tennis" and "sports" tags
  3. Track responses through question flow
  4. Verify matches created for "Let's talk in person" responses
- **Expected Results**: Only matching users progress to final question, matches created appropriately

#### TC-BM-003: Reputation-Based Send Limits
- **Objective**: Verify send capacity adjusts based on reputation
- **Steps**:
  1. Test sending with good reputation user
  2. Test sending with user who has been blocked multiple times
  3. Verify capacity differences
- **Expected Results**: Send capacity reduced for users with poor reputation

### 4.7 Survey System Testing

#### TC-SV-001: Survey Creation and Execution
- **Objective**: Test survey talk functionality
- **Prerequisites**: Business chatroom with multiple users
- **Steps**:
  1. Create survey talk with aggregatable questions
  2. Send to business chatroom users
  3. Collect responses from multiple users
  4. Verify aggregation calculations
- **Expected Results**: Survey responses collected and aggregated correctly

#### TC-SV-002: Customer Satisfaction Survey (from SRS Example)
- **Objective**: Complete customer satisfaction survey scenario
- **Steps**:
  1. Business owner creates satisfaction survey
  2. Send to all business chatroom users
  3. Users respond with various ratings
  4. Verify aggregated statistics are correct
  5. Test follow-up conversation creation
- **Expected Results**: Statistics calculated correctly, follow-up conversations created for opted-in users

### 4.8 Spam Prevention & Moderation Testing

#### TC-SP-001: Rate Limiting
- **Objective**: Verify send/receive rate limits
- **Steps**:
  1. Attempt to exceed daily/weekly send limits
  2. Verify symmetric limiting (send/receive)
  3. Test rate limit reset functionality
- **Expected Results**: Rate limits enforced, symmetric application

#### TC-SP-002: Blocking Functionality
- **Objective**: Test user blocking system
- **Steps**:
  1. User A blocks User B
  2. Verify User B cannot send talks to User A
  3. Verify User B cannot view User A's profile
  4. Test block list management
- **Expected Results**: Blocking prevents communication and profile access

#### TC-SP-003: Age Verification and Content Filtering
- **Objective**: Test adult content restrictions
- **Steps**:
  1. Create adult content talk with age verification
  2. Test with underage user account
  3. Test with adult user account
  4. Verify age verification contributes to reputation
- **Expected Results**: Underage users never see adult content, age verification tracked

### 4.9 Tag System Testing

#### TC-TG-001: Tag Creation and Categorization
- **Objective**: Test tag system functionality
- **Steps**:
  1. Create tags in various Craigslist-style categories
  2. Attach tags to talks, questions, and profiles
  3. Test regional popularity tracking
  4. Verify tag suggestions work
- **Expected Results**: Tags created, categorized, and suggested based on popularity

#### TC-TG-002: Pre-filtering with Tags
- **Objective**: Verify mandatory tag/location preamble
- **Steps**:
  1. Create talk without pre-filter step
  2. Verify system enforces tag/location pre-filter
  3. Test bulk sending with tag filters
- **Expected Results**: All talks must begin with tag/location pre-filter

### 4.10 Platform-Specific Testing

#### TC-PS-001: Web Platform Testing
- **Objective**: Verify web platform functionality
- **Test Matrix**:
  - Chrome (latest, previous version)
  - Firefox (latest, previous version)
  - Safari (latest, previous version)
  - Edge (latest, previous version)
- **Steps**: Execute core functionality tests on each browser
- **Expected Results**: Consistent behavior across all supported browsers

#### TC-PS-002: Android Platform Testing
- **Objective**: Verify Android platform functionality
- **Test Matrix**:
  - Various Android versions (API levels)
  - Different screen sizes and orientations
  - Different device manufacturers
- **Steps**: Execute mobile-specific tests including GPS, notifications, background processing
- **Expected Results**: Consistent functionality across Android devices

#### TC-PS-003: Cross-Platform Consistency
- **Objective**: Verify feature parity between platforms
- **Steps**:
  1. Execute same user scenarios on web and Android
  2. Compare functionality and user experience
  3. Test data synchronization between platforms
- **Expected Results**: Feature parity maintained, data syncs correctly

---

## 5. Performance Testing

### 5.1 Load Testing Scenarios

#### TC-PERF-001: Concurrent Conversations
- **Objective**: Test system performance with 1000 concurrent conversations per user
- **Method**: Simulate multiple users with maximum conversation load
- **Metrics**: Response time, memory usage, CPU utilization
- **Acceptance Criteria**: System remains responsive under maximum load

#### TC-PERF-002: Bulk Send Performance
- **Objective**: Verify bulk send to 1000 recipients completes within acceptable time
- **Method**: Send talk to maximum recipients, measure initialization and delivery time
- **Metrics**: Time to initialize, delivery success rate, system resource usage
- **Acceptance Criteria**: Initialization within 5 seconds, 95% delivery success rate

#### TC-PERF-003: Chatroom Scaling
- **Objective**: Test automatic chatroom splitting performance
- **Method**: Gradually increase users in chatroom to trigger splitting
- **Metrics**: Split trigger accuracy, user migration time, system stability
- **Acceptance Criteria**: Split occurs at threshold, migration completes quickly

### 5.2 Stress Testing

#### TC-STRESS-001: Peak Load Testing
- **Objective**: Test system behavior beyond normal capacity
- **Method**: Gradually increase load until system degradation
- **Metrics**: Breaking point identification, graceful degradation
- **Acceptance Criteria**: System degrades gracefully, no data loss

#### TC-STRESS-002: Resource Exhaustion
- **Objective**: Test behavior when system resources are exhausted
- **Method**: Simulate memory and storage constraints
- **Metrics**: Error handling, recovery capabilities
- **Acceptance Criteria**: Appropriate error messages, system recovery possible

---

## 6. Security and Privacy Testing

### 6.1 Privacy Testing

#### TC-SEC-001: Location Privacy
- **Objective**: Verify true location is never exposed
- **Steps**:
  1. Monitor all data transmissions
  2. Verify only blurred regions are transmitted
  3. Test location-based chatroom placement
- **Expected Results**: True GPS coordinates never exposed in any communication

#### TC-SEC-002: User Data Protection
- **Objective**: Verify user data is properly protected
- **Steps**:
  1. Test data encryption in storage and transmission
  2. Verify personal data access controls
  3. Test data retention and deletion
- **Expected Results**: All personal data properly encrypted and protected

### 6.2 Input Validation Testing

#### TC-SEC-003: Input Sanitization
- **Objective**: Test protection against malicious inputs
- **Steps**:
  1. Submit various injection attack attempts
  2. Test with malformed data
  3. Verify input length and format validation
- **Expected Results**: All inputs properly validated and sanitized

---

## 7. User Acceptance Testing Scenarios

### 7.1 Business Use Cases

#### UAT-001: Dating Scenario
- **Scenario**: User wants to find a date at a specific bar
- **Steps**: Complete dating talk creation, sending, filtering, and matching process
- **Success Criteria**: User successfully matches with compatible date prospects

#### UAT-002: Buying/Selling Scenario
- **Scenario**: User wants to buy/sell used items
- **Steps**: Create and execute buying/selling talks with location and price filtering
- **Success Criteria**: Successful matches between buyers and sellers

#### UAT-003: Hobby Matching Scenario
- **Scenario**: User wants to find hobby partners (tennis, guitar, etc.)
- **Steps**: Use interest tags and location filtering to find hobby partners
- **Success Criteria**: User finds compatible hobby partners in their area

#### UAT-004: Business Survey Scenario
- **Scenario**: Business owner wants customer feedback
- **Steps**: Create and execute customer satisfaction survey
- **Success Criteria**: Collect meaningful feedback with statistical aggregation

---

## 8. Automation Strategy

### 8.1 Automated Test Coverage
- **Unit Tests**: 80% code coverage minimum
- **API Tests**: All critical API endpoints
- **UI Tests**: Core user journeys and workflows
- **Performance Tests**: Load and stress testing scenarios

### 8.2 Test Automation Tools
- **Unit Testing**: Jest, Mocha
- **Integration Testing**: Custom Gun.js test harness
- **UI Testing**: Playwright, Cypress
- **Performance Testing**: K6, Artillery
- **Mobile Testing**: Appium, Espresso

### 8.3 Continuous Integration
- **Build Pipeline**: Automated build and test on every commit
- **Test Execution**: Automated test suite execution
- **Quality Gates**: Minimum coverage and test pass rates
- **Deployment**: Automated deployment to staging after successful tests

---

## 9. Test Execution Schedule

### 9.1 Development Phase Testing
- **Unit Testing**: Ongoing during development
- **Integration Testing**: Weekly integration builds
- **Component Testing**: Bi-weekly component validation

### 9.2 System Testing Phase
- **Duration**: 4 weeks
- **Week 1**: Core functionality testing
- **Week 2**: Integration and platform testing
- **Week 3**: Performance and security testing
- **Week 4**: User acceptance testing and bug fixes

### 9.3 Release Testing
- **Pre-Release Testing**: Final validation before release
- **Post-Release Monitoring**: Production monitoring and issue tracking

---

## 10. Risk Analysis and Mitigation

### 10.1 Technical Risks
- **Gun.js Connectivity Issues**: Implement fallback mechanisms and offline capability
- **Performance Degradation**: Regular performance monitoring and optimization
- **Cross-Platform Inconsistencies**: Comprehensive platform testing matrix

### 10.2 Business Risks
- **User Adoption**: Extensive UAT with real users
- **Privacy Concerns**: Thorough security and privacy testing
- **Content Moderation**: Robust filtering and reputation system testing

### 10.3 Operational Risks
- **Scalability Issues**: Load testing beyond expected capacity
- **Data Loss**: Comprehensive backup and recovery testing
- **Service Availability**: Resilience and failover testing

---

## 11. Success Criteria and Exit Criteria

### 11.1 Success Criteria
- All critical and high-priority test cases pass
- Performance benchmarks met (1000 concurrent conversations, bulk send performance)
- Security and privacy requirements validated
- Cross-platform functionality verified
- User acceptance testing completed successfully

### 11.2 Exit Criteria
- Test execution completion rate: 95%
- Critical and high severity defects: 0
- Medium severity defects: <5
- Performance criteria met
- Security validation complete
- Stakeholder approval obtained

---

## 12. Defect Management

### 12.1 Defect Classification
- **Critical**: System crashes, data loss, security vulnerabilities
- **High**: Major functionality not working, performance issues
- **Medium**: Minor functionality issues, usability problems
- **Low**: Cosmetic issues, minor improvements

### 12.2 Defect Tracking
- Use of bug tracking system (Jira, GitHub Issues, etc.)
- Clear defect reporting standards
- Priority and severity assignment guidelines
- Resolution and verification process

---

## 13. Test Deliverables

### 13.1 Test Documentation
- Test Plan (this document)
- Test Case Specifications
- Test Execution Reports
- Defect Reports
- Performance Test Results
- Security Test Results
- User Acceptance Test Results

### 13.2 Test Artifacts
- Automated test scripts
- Test data sets
- Test environment configurations
- Performance benchmarks
- Security validation reports

---

This comprehensive test plan provides structured validation of all IinPublic system requirements while ensuring quality, performance, and user satisfaction. The plan should be updated as requirements evolve and new features are added.