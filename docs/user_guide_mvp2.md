# RE-Archaeology Framework MVP2 - User Guide

Welcome to the enhanced RE-Archaeology Framework! This guide covers all the new features and capabilities introduced in MVP2.

## Table of Contents

1. [Getting Started](#getting-started)
2. [Google Authentication](#google-authentication)
3. [Enhanced Thread Discussions](#enhanced-thread-discussions)
4. [AI Chat Integration](#ai-chat-integration)
5. [Background Task Monitoring](#background-task-monitoring)
6. [Enhanced Earth Engine Maps](#enhanced-earth-engine-maps)
7. [Real-time Features](#real-time-features)
8. [Troubleshooting](#troubleshooting)

## Getting Started

### System Requirements

- Modern web browser (Chrome, Firefox, Safari, Edge)
- Stable internet connection
- Google account (for authentication)

### Accessing the Platform

1. Navigate to the RE-Archaeology dashboard
2. Sign in with your Google account
3. Explore the enhanced interface with new MVP2 features

## Google Authentication

### Signing In

1. Click the **"Sign in with Google"** button in the top navigation
2. Select your Google account or sign in if prompted
3. Grant permissions for the RE-Archaeology application
4. You'll be redirected back with full access to authenticated features

### Profile Management

- Your profile picture and name appear in the top-right corner
- Click on your profile to access user settings
- Use the **Logout** button to end your session securely

### Authentication Benefits

- **Thread Participation**: Create threads and post comments
- **AI Chat Access**: Use the intelligent search and chat features
- **Personalized Experience**: Customized content and recommendations
- **Progress Tracking**: Monitor your contributions and activities

## Enhanced Thread Discussions

### Thread Categories

MVP2 introduces organized thread categories:

#### 📍 Maps
- Geographical visualizations and satellite imagery
- LIDAR data analysis and interpretation
- Interactive mapping projects
- Spatial pattern discussions

#### 📚 Researches
- Academic papers and methodology debates
- Research collaboration and peer review
- Study findings and analysis
- Literature discussions

#### 🏛️ Sites
- Archaeological site discoveries
- Excavation reports and documentation
- Heritage preservation discussions
- Site-specific knowledge sharing

#### 🖥️ RE Theory
- Reverse Engineering archaeological theory
- Computational archaeology methods
- AI-assisted analysis techniques
- Innovative research approaches

#### 💬 General Discussion
- Open forum for general topics
- Community announcements
- News and updates
- Casual conversations

#### 🗄️ Data & Tools
- Dataset sharing and collaboration
- Software tools and APIs
- Technical resources
- Data standards discussion

### Creating Threads

1. **Select Category**: Choose the appropriate category for your topic
2. **Authentication Required**: Must be signed in to create threads
3. **Title & Description**: Provide clear, descriptive information
4. **Tags**: Add relevant tags for better discoverability

### Commenting System

- **Nested Comments**: Reply to specific comments for organized discussions
- **Real-time Updates**: See new comments as they're posted
- **Edit & Delete**: Modify your own comments (with edit history)
- **Markdown Support**: Use markdown formatting for rich text

### Thread Filtering

- Use category filters to focus on specific topics
- Search within threads using keywords
- Sort by recent activity, creation date, or popularity

## AI Chat Integration

### Accessing AI Chat

1. Click the **AI Chat** tab in the main interface
2. Ensure you're authenticated (required for AI features)
3. Start asking questions or requesting assistance

### Features

#### Semantic Search
- Ask questions about archaeological content
- Search across threads, sites, and research papers
- Get contextually relevant results

#### Intelligent Responses
- Powered by OpenAI's advanced language models
- Context-aware answers based on your query
- Integration with platform knowledge base

#### Chat History
- Persistent conversation history
- Previous context awareness
- Export chat transcripts

### Best Practices

1. **Be Specific**: Provide detailed questions for better responses
2. **Context Matters**: Reference specific sites, papers, or concepts
3. **Follow-up Questions**: Build on previous responses for deeper insights
4. **Fact Verification**: Always verify AI responses with primary sources

### Example Queries

- "What LIDAR techniques are best for detecting Maya settlements?"
- "Show me threads about Roman villa excavations"
- "Explain the archaeological significance of [specific site]"
- "Find research papers about computational archaeology methods"

## Background Task Monitoring

### Task Indicator

- **Location**: Top-right corner of the interface
- **Real-time Updates**: Shows active background processes
- **Click to Expand**: View detailed task information

### Task Types

#### Data Processing
- LIDAR data analysis
- Satellite image processing
- Large dataset computations

#### AI Analysis
- Machine learning model training
- Pattern recognition tasks
- Automated classification

#### Documentation
- Report generation
- Data compilation
- Export operations

#### Reconstruction
- 3D model generation
- Site visualization
- Virtual reality preparation

### Task Status

- **Pending** ⏳: Queued for execution
- **Running** 🏃: Currently processing
- **Completed** ✅: Successfully finished
- **Failed** ❌: Error occurred (with retry options)

### Monitoring Features

- **Progress Bars**: Visual progress indicators
- **Time Estimates**: Estimated completion times
- **Real-time Updates**: Live status changes
- **Detailed Logs**: Error messages and debug information
- **Priority Levels**: High, medium, low priority tasks

## Enhanced Earth Engine Maps

### Accessing Maps

1. Navigate to the **Maps** category in threads
2. Click **"Generate Map"** or **"Open Map Interface"**
3. Choose your region and analysis type

### Features

#### Interactive Layers
- Satellite imagery (Landsat, Sentinel)
- LIDAR elevation data
- Archaeological site overlays
- Custom data imports

#### Analysis Tools
- Vegetation analysis
- Elevation profiling
- Change detection
- Anomaly identification

#### Export Options
- High-resolution image export
- Data layer downloads
- Shareable map links
- PDF report generation

### Supported Regions

- **Netherlands Windmills**: Specialized LIDAR analysis
- **Amazonian Basin**: Deforestation and site detection
- **Mediterranean**: Classical archaeology focus
- **Custom Regions**: User-defined areas of interest

### Map Integration

- **Thread-Specific Maps**: Maps linked to discussion threads
- **Background Processing**: Large analysis tasks run in background
- **Collaborative Mapping**: Share maps with community members

## Real-time Features

### WebSocket Connections

MVP2 includes real-time capabilities:

#### Live Thread Updates
- New comments appear instantly
- User join/leave notifications
- Typing indicators

#### Connection Status
- Real-time connection monitoring
- Automatic reconnection handling
- Connection quality indicators

### Notification System

- **Task Completion**: Alerts when background tasks finish
- **New Comments**: Notifications for thread activity
- **System Updates**: Important announcements
- **Error Alerts**: Real-time error notifications

## Troubleshooting

### Common Issues

#### Authentication Problems

**Issue**: Google sign-in not working
**Solution**: 
- Clear browser cache and cookies
- Ensure pop-ups are enabled
- Try incognito/private browsing mode
- Check if third-party cookies are allowed

#### WebSocket Connection Issues

**Issue**: Real-time features not working
**Solution**:
- Check internet connection stability
- Refresh the page to reconnect
- Disable browser extensions that might block WebSockets
- Try a different browser

#### AI Chat Not Responding

**Issue**: AI chat not providing responses
**Solution**:
- Ensure you're authenticated
- Check if AI service is available (status indicator)
- Try shorter, more specific questions
- Refresh the page and try again

#### Background Tasks Stuck

**Issue**: Tasks showing as "running" for too long
**Solution**:
- Large tasks can take time - check estimated duration
- Refresh the task panel for updated status
- Contact support if tasks remain stuck for hours

### Performance Optimization

#### For Better Performance:
- Close unused browser tabs
- Use a modern browser with hardware acceleration
- Ensure stable internet connection for real-time features
- Clear browser cache periodically

### Getting Help

#### Community Support
- Post questions in the **General Discussion** category
- Search existing threads for similar issues
- Use the AI chat for quick troubleshooting

#### Technical Support
- Report bugs through the feedback system
- Include browser information and error messages
- Provide steps to reproduce issues

## Advanced Features

### API Integration

For developers and advanced users:

- **REST API**: Access platform data programmatically
- **WebSocket API**: Real-time data streaming
- **Authentication**: JWT token-based access
- **Rate Limiting**: Respectful API usage guidelines

### Data Export

- **Thread Exports**: Download discussion data
- **Map Exports**: High-resolution map images and data
- **Chat Transcripts**: AI conversation history
- **Task Reports**: Detailed background task results

### Customization

- **Dashboard Layout**: Customize panel arrangements
- **Notification Preferences**: Control alert types
- **Category Filters**: Save preferred discussion topics
- **Theme Settings**: Adjust visual appearance

## What's Next?

MVP2 represents a major enhancement to the RE-Archaeology Framework. Future updates will include:

- Enhanced 3D visualization capabilities
- Expanded AI analysis tools
- Additional Earth Engine datasets
- Mobile application support
- Collaborative annotation tools

---

## Support and Feedback

We value your feedback and suggestions for improving the platform. Please use the built-in feedback tools or contact our support team for assistance.

**Happy exploring!** 🏛️🔍

---

*Last updated: [Current Date]*
*Version: MVP2*
