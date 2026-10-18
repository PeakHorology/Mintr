// electron-builder accepts only semver. Mintr3d releases use a four-part
// Windows version such as 1.0.7.5, which is what the installer must show.
const Module = require("module");

const originalRequire = Module.prototype.require;
const FOUR_PART = /^\d+\.\d+\.\d+\.\d+$/;

Module.prototype.require = function (id) {
  const loaded = originalRequire.apply(this, arguments);
  if (id === "semver" && loaded && typeof loaded.valid === "function" && !loaded.__mintrFourPart) {
    const valid = loaded.valid.bind(loaded);
    const clean = loaded.clean.bind(loaded);
    loaded.valid = (version, options) => (typeof version === "string" && FOUR_PART.test(version) ? version : valid(version, options));
    loaded.clean = (version, options) => (typeof version === "string" && FOUR_PART.test(version) ? version : clean(version, options));
    Object.defineProperty(loaded, "__mintrFourPart", { value: true });
  }
  return loaded;
};
