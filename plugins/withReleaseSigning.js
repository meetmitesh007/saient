// Expo config plugin: make Android release signing durable across prebuilds.
//
// Release credentials are read from the durable, gitignored
// release/credentials/keystore.properties file, android/keystore.properties,
// or the SAIENT_ANDROID_* environment variables. A release task fails closed
// when credentials are absent. Local smoke builds must opt in explicitly with
// SAIENT_ALLOW_DEBUG_RELEASE=true; that escape hatch is rejected by the
// production release script.

const { withAppBuildGradle } = require('@expo/config-plugins');

const VARIABLES_MARKER = '// SAIENT_RELEASE_SIGNING_VARIABLES';
const CONFIG_MARKER = '// SAIENT_RELEASE_SIGNING_CONFIG';
const BUILD_TYPE_MARKER = '// SAIENT_RELEASE_SIGNING_BUILD_TYPE';

const VARIABLES = `${VARIABLES_MARKER}
def saientReleasePropertiesFile = [
    rootProject.file("../release/credentials/keystore.properties"),
    rootProject.file("keystore.properties"),
].find { candidate -> candidate.isFile() }
def saientReleaseProperties = new Properties()
if (saientReleasePropertiesFile != null) {
    saientReleasePropertiesFile.withInputStream { stream ->
        saientReleaseProperties.load(stream)
    }
}
def saientReleaseValue = { String propertyName, String environmentName ->
    def environmentValue = System.getenv(environmentName)?.trim()
    environmentValue ?: saientReleaseProperties.getProperty(propertyName)?.trim()
}
def saientReleaseStoreFile = saientReleaseValue("storeFile", "SAIENT_ANDROID_KEYSTORE_PATH")
def saientReleaseStorePassword = saientReleaseValue("storePassword", "SAIENT_ANDROID_KEYSTORE_PASSWORD")
def saientReleaseKeyAlias = saientReleaseValue("keyAlias", "SAIENT_ANDROID_KEY_ALIAS")
def saientReleaseKeyPassword = saientReleaseValue("keyPassword", "SAIENT_ANDROID_KEY_PASSWORD")
def saientReleaseSigningReady = [
    saientReleaseStoreFile,
    saientReleaseStorePassword,
    saientReleaseKeyAlias,
    saientReleaseKeyPassword,
].every { value -> value != null && !value.isEmpty() } && rootProject.file(saientReleaseStoreFile ?: ".").isFile()
def saientReleaseRequested = gradle.startParameter.taskNames.any { taskName ->
    taskName.toLowerCase().contains("release")
}
def saientAllowDebugRelease = ["1", "true", "yes"].contains(
    (System.getenv("SAIENT_ALLOW_DEBUG_RELEASE") ?: "false").trim().toLowerCase()
)

`;

const SIGNING_CONFIG = `
        ${CONFIG_MARKER}
        if (saientReleaseSigningReady) {
            release {
                storeFile rootProject.file(saientReleaseStoreFile)
                storePassword saientReleaseStorePassword
                keyAlias saientReleaseKeyAlias
                keyPassword saientReleaseKeyPassword
            }
        }
`;

const RELEASE_SIGNING = `            ${BUILD_TYPE_MARKER}
            if (saientReleaseSigningReady) {
                signingConfig signingConfigs.release
            } else if (saientAllowDebugRelease) {
                signingConfig signingConfigs.debug
            } else if (saientReleaseRequested) {
                throw new GradleException("Saient release signing is not configured. Run npm run android:signing:init, provide android/keystore.properties, or set all four SAIENT_ANDROID_* signing variables. For a non-production smoke build only, set SAIENT_ALLOW_DEBUG_RELEASE=true.")
            }`;

function blockBounds(source, header, fromIndex = 0) {
  const headerIndex = source.indexOf(header, fromIndex);
  if (headerIndex < 0) return null;
  const openingBrace = source.indexOf('{', headerIndex);
  if (openingBrace < 0) return null;
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return { headerIndex, openingBrace, closingBrace: index };
    }
  }
  return null;
}

function injectSigningConfig(source) {
  if (source.includes(CONFIG_MARKER)) return source;
  const block = blockBounds(source, 'signingConfigs {');
  if (!block) throw new Error('Could not find android.signingConfigs in app/build.gradle');
  const closingLineStart = source.lastIndexOf('\n', block.closingBrace) + 1;
  const closingIndent = source.slice(closingLineStart, block.closingBrace);
  return `${source.slice(0, closingLineStart)}${SIGNING_CONFIG}${closingIndent}${source.slice(block.closingBrace)}`;
}

function replaceReleaseSigning(source) {
  if (source.includes(BUILD_TYPE_MARKER)) return source;
  const buildTypes = blockBounds(source, 'buildTypes {');
  if (!buildTypes) throw new Error('Could not find android.buildTypes in app/build.gradle');
  const release = blockBounds(source, 'release {', buildTypes.openingBrace);
  if (!release || release.closingBrace > buildTypes.closingBrace) {
    throw new Error('Could not find android.buildTypes.release in app/build.gradle');
  }

  const releaseBlock = source.slice(release.openingBrace + 1, release.closingBrace);
  const debugSigning = /^\s*signingConfig\s+signingConfigs\.debug\s*$/m;
  const withoutTemplateWarning = releaseBlock.replace(
    /^\s*\/\/ Caution! In production[^\n]*\n\s*\/\/ see https:\/\/reactnative\.dev\/docs\/signed-apk-android\.\n/m,
    '',
  );
  const nextBlock = debugSigning.test(withoutTemplateWarning)
    ? withoutTemplateWarning.replace(debugSigning, `\n${RELEASE_SIGNING}`)
    : `\n${RELEASE_SIGNING}${withoutTemplateWarning}`;
  return `${source.slice(0, release.openingBrace + 1)}${nextBlock}${source.slice(release.closingBrace)}`;
}

module.exports = (config) =>
  withAppBuildGradle(config, (cfg) => {
    let source = cfg.modResults.contents;
    if (!source.includes(VARIABLES_MARKER)) {
      const androidBlock = source.indexOf('\nandroid {');
      if (androidBlock < 0) throw new Error('Could not find android block in app/build.gradle');
      source = `${source.slice(0, androidBlock + 1)}${VARIABLES}${source.slice(androidBlock + 1)}`;
    }
    source = injectSigningConfig(source);
    source = replaceReleaseSigning(source);
    cfg.modResults.contents = source;
    return cfg;
  });
