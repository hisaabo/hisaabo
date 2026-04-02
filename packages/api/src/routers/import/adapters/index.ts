// Import all adapter index files to trigger registerAdapter() side-effects.
// The import router's index.ts imports this file to ensure all adapters are
// registered before any procedure runs.
import "./mybillbook/index.js";
import "./hisaabo/index.js";
