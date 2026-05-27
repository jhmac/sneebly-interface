// pnpm hook: rewrite @electron/rebuild's git-URL dep on @electron/node-gyp to the
// npm-published equivalent so pnpm v11's blockExoticSubdeps check is not triggered.
//
// @electron/rebuild@3.7.2 pins "@electron/node-gyp" to a specific git commit:
//   https://github.com/electron/node-gyp#06b29aafb7708acef8b3669835c8a7857ebc92d2
// That commit corresponds exactly to the npm-published 10.2.0-electron.1 release.
// Redirecting to the npm version is semantically identical and avoids the pnpm v11
// blockExoticSubdeps block without disabling the security feature globally.

function readPackage(pkg) {
  if (pkg.name === '@electron/rebuild' && pkg.dependencies && pkg.dependencies['@electron/node-gyp']) {
    pkg.dependencies['@electron/node-gyp'] = '10.2.0-electron.1';
  }
  return pkg;
}

module.exports = {
  hooks: {
    readPackage,
  },
};
