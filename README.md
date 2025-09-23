# electron_helper

Little useful scripts mostly to deal with renderer -> main communication.

## Version 2.0.0 (2025-09-23)

This release introduces significant improvements and new features in preparation for a stable release:

### New Features
- **Unified API Initialization**: Streamlined setup for main and renderer processes with consistent IPC handling.
- **Enhanced Error Handling**: Process-level and renderer-specific error handlers to surface uncaught exceptions and rejections.
- **Config Backup and Restore**: Automatic backup of config files on changes, with restoration from backup if corruption is detected.
- **Improved HTTP Client**: `tools.jRequest` now supports both HTTP and HTTPS, GET/POST methods, and wraps non-JSON responses in objects.
- **Comprehensive Test Suite**: Added `test.js` for validating all APIs, including IPC communication, file operations, and error scenarios.

### Files
- `helper.js`: Original preload script (default).
- `helper_new.js`: Refactored version with advanced features (non-default).
- `test.js`: Test harness for API validation.
- `update.js`: Update utilities.

### Usage
Preload `helper.js` or `helper_new.js` in your Electron app for renderer-main communication.

Run tests with `npm run start` to validate functionality.

### Preparation for Release
- All APIs tested and verified.
- Error handling improved for production stability.
- Config robustness added to prevent data loss.

For more details, see the code comments and test outputs.
