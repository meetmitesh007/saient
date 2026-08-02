import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useFocusEffect } from "expo-router";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { C } from "@/lib/theme";
import {
  addDiffusionDownloadProgressListener,
  addDiffusionProgressListener,
  cancelDiffusionModelDownload,
  cancelLocalImage,
  diffusionAvailable,
  downloadDiffusionModel,
  generateLocalImage,
  getDiffusionStatus,
  removeDiffusionModel,
  type DiffusionGenerationResult,
  type DiffusionDownloadProgress,
  type DiffusionProgress,
  type DiffusionStatus,
} from "@/modules/saient-diffusion";

type Preset = { steps: number; label: string };

const PRESETS: Preset[] = [
  { steps: 4, label: "Quick" },
  { steps: 6, label: "Balanced" },
  { steps: 10, label: "Detailed" },
  { steps: 20, label: "Quality" },
];
const INTRO_KEY = "saient.local-diffusion-intro.sdxl.v1";

function fmtBytes(bytes: number) {
  return bytes >= 1_000_000_000
    ? `${(bytes / 1_000_000_000).toFixed(2)} GB`
    : `${Math.round(bytes / 1_000_000)} MB`;
}

function progressFraction(progress: DiffusionProgress | null) {
  if (!progress) return 0;
  const part = progress.total > 0 ? progress.completed / progress.total : 0;
  if (progress.phase === "encoding") return part * 0.08;
  if (progress.phase === "denoising") return 0.08 + part * 0.84;
  return 0.92 + part * 0.08;
}

function progressLabel(progress: DiffusionProgress | null) {
  if (!progress) return "Preparing Quartz";
  if (progress.phase === "encoding") return "Encoding prompt";
  if (progress.phase === "decoding") return "Decoding PNG";
  return progress.completed > 0
    ? `Denoising ${progress.completed} of ${progress.total}`
    : "Starting denoising";
}

export default function CreateScreen() {
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<DiffusionStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [cancellingDownload, setCancellingDownload] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [steps, setSteps] = useState(4);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 2_147_483_647));
  const [progress, setProgress] = useState<DiffusionProgress | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DiffusionDownloadProgress | null>(null);
  const [result, setResult] = useState<DiffusionGenerationResult | null>(null);

  const refresh = useCallback(async () => {
    setChecking(true);
    try {
      setStatus(await getDiffusionStatus());
    } catch (error) {
      setStatus({
        available: false,
        installed: false,
        valid: false,
        active: false,
        modelBytes: 0,
        message: String(error),
      });
    } finally {
      setChecking(false);
    }
  }, []);

  const downloadModel = useCallback(async () => {
    setDownloading(true);
    setDownloadProgress(null);
    try {
      const next = await downloadDiffusionModel();
      setStatus(next);
      Alert.alert("Image model ready", "Quartz verified and installed the SDXL FP16 pack.");
    } catch (error) {
      const message = String(error);
      if (!message.toLocaleLowerCase().includes("cancel")) {
        Alert.alert("Could not download image model", message);
      }
      await refresh();
    } finally {
      setDownloading(false);
      setCancellingDownload(false);
    }
  }, [refresh]);

  const cancelDownload = useCallback(async () => {
    setCancellingDownload(true);
    try {
      await cancelDiffusionModelDownload();
    } finally {
      setCancellingDownload(false);
    }
  }, []);

  useEffect(() => {
    const progressSubscription = diffusionAvailable()
      ? addDiffusionProgressListener(setProgress)
      : null;
    const downloadSubscription = diffusionAvailable()
      ? addDiffusionDownloadProgressListener(setDownloadProgress)
      : null;
    return () => {
      progressSubscription?.remove();
      downloadSubscription?.remove();
    };
  }, [refresh]);

  useFocusEffect(useCallback(() => {
    void refresh();
  }, [refresh]));

  useEffect(() => {
    if (checking || status?.valid) return;
    let active = true;
    void SecureStore.getItemAsync(INTRO_KEY).then((seen) => {
      if (!active || seen) return;
      void SecureStore.setItemAsync(INTRO_KEY, "1").catch(() => {});
      Alert.alert(
        "Image model needed",
        "Phone image generation is offline and the model is not bundled into the APK. Saient can download and verify the 6.94 GB SDXL FP16 pack now.",
        [
          { text: "Later", style: "cancel" },
          { text: "Download", onPress: () => { void downloadModel(); } },
        ],
      );
    }).catch(() => {});
    return () => { active = false; };
  }, [checking, downloadModel, status?.valid]);

  const generate = useCallback(async () => {
    if (!status?.valid) {
      Alert.alert("Image model needed", "Download the Saient SDXL model first.");
      return;
    }
    if (!status.active) {
      Alert.alert("Image model inactive", "Open Models and activate Saient SDXL before generating.");
      return;
    }
    if (!prompt.trim()) {
      Alert.alert("Prompt needed", "Describe the image you want Quartz to create.");
      return;
    }
    setGenerating(true);
    setProgress(null);
    setResult(null);
    try {
      setResult(await generateLocalImage({
        prompt: prompt.trim(),
        negativePrompt: negativePrompt.trim(),
        steps,
        guidance: 5.0,
        seed,
      }));
    } catch (error) {
      const message = String(error);
      if (!message.toLocaleLowerCase().includes("cancel")) {
        Alert.alert("Image generation failed", message);
      }
    } finally {
      setGenerating(false);
      setCancelling(false);
    }
  }, [negativePrompt, prompt, seed, status?.active, status?.valid, steps]);

  const cancel = useCallback(async () => {
    setCancelling(true);
    try {
      await cancelLocalImage();
    } finally {
      setCancelling(false);
    }
  }, []);

  const removePack = useCallback(() => {
    Alert.alert(
      "Remove image model?",
      "This frees about 6.94 GB. Your generated images stay on the phone.",
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            void removeDiffusionModel()
              .then(setStatus)
              .catch((error) => Alert.alert("Could not remove model", String(error)));
          },
        },
      ],
    );
  }, []);

  const fraction = progressFraction(progress);
  const downloadFraction = downloadProgress && downloadProgress.totalBytes > 0
    ? downloadProgress.completedBytes / downloadProgress.totalBytes
    : 0;
  const busy = downloading || generating;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{ padding: 16, paddingTop: insets.top + 8, paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.h1}>Create</Text>
          <Text style={styles.sub}>SDXL, entirely on this phone through Quartz</Text>
        </View>
        <View style={[styles.state, status?.active ? styles.stateReady : styles.stateWaiting]}>
          <Ionicons name={status?.active ? "checkmark-circle" : status?.valid ? "pause-circle-outline" : "download-outline"} size={15} color={status?.active ? C.green : C.amber} />
          <Text style={{ color: status?.active ? C.green : C.amber, fontSize: 11, fontWeight: "700" }}>
            {checking ? "Checking" : status?.active ? "Ready" : status?.valid ? "Inactive" : "Model needed"}
          </Text>
        </View>
      </View>

      {!status?.valid ? (
        <View style={styles.setupCard}>
          <View style={styles.setupIcon}>
            <Ionicons name="images-outline" size={34} color={C.accent} />
          </View>
          <Text style={styles.setupTitle}>Add the Saient image model</Text>
          <Text style={styles.setupText}>
            Download the SDXL FP16 pack directly from the Saient Pi. Quartz verifies every file before an atomic install; interrupted downloads resume.
          </Text>
          <Text style={styles.setupMeta}>About 6.94 GB · 1024×1024 · offline after setup</Text>
          <Pressable
            style={[styles.primary, busy && styles.disabled]}
            onPress={() => { void downloadModel(); }}
            disabled={busy || !status?.available}
            accessibilityRole="button"
            accessibilityState={{ disabled: busy || !status?.available }}
          >
            <Ionicons name={downloading ? "cloud-download-outline" : "download-outline"} size={18} color={C.bg} />
            <Text style={styles.primaryText}>
              {downloading ? `Downloading ${Math.floor(downloadFraction * 100)}%` : "Download model · 6.94 GB"}
            </Text>
          </Pressable>
          {downloading && (
            <View style={styles.downloadProgress}>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${Math.floor(downloadFraction * 100)}%` }]} />
              </View>
              <Text style={styles.downloadFile} numberOfLines={1}>{downloadProgress?.currentFile ?? "Connecting to Saient"}</Text>
              <Pressable
                style={[styles.downloadCancel, cancellingDownload && styles.disabled]}
                onPress={() => { void cancelDownload(); }}
                disabled={cancellingDownload}
                accessibilityRole="button"
                accessibilityState={{ disabled: cancellingDownload }}
              >
                <Text style={styles.cancelText}>{cancellingDownload ? "Stopping…" : "Cancel download"}</Text>
              </Pressable>
            </View>
          )}
          <Pressable
            style={styles.licenseButton}
            onPress={() => { void WebBrowser.openBrowserAsync("https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0"); }}
            accessibilityRole="link"
          >
            <Text style={styles.licenseText}>Stable Diffusion XL base 1.0 · OpenRAIL++</Text>
          </Pressable>
          {!!status?.message && <Text style={styles.statusMessage}>{status.message}</Text>}
        </View>
      ) : (
        <>
          <View style={[styles.modelCard, !status.active && { borderColor: C.amber }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.modelName}>Saient SDXL FP16</Text>
              <Text style={styles.modelMeta}>
                {fmtBytes(status.modelBytes)} · {status.active ? "Active" : "Inactive"} · Quartz-owned Vulkan runtime
              </Text>
            </View>
            <Pressable onPress={removePack} disabled={busy} hitSlop={10} accessibilityRole="button" accessibilityLabel="Remove image model">
              <Ionicons name="trash-outline" size={18} color={C.text3} />
            </Pressable>
          </View>

          {!status.active && (
            <View style={styles.inactiveNotice}>
              <Ionicons name="battery-half-outline" size={17} color={C.amber} />
              <Text style={styles.inactiveText}>Image inference is disabled. Activate SDXL from Models when you want to generate.</Text>
            </View>
          )}

          <Text style={styles.label}>Prompt</Text>
          <TextInput
            style={styles.prompt}
            value={prompt}
            onChangeText={setPrompt}
            editable={!busy}
            multiline
            maxLength={1000}
            placeholder="A cinematic photo of a fox in a snowy forest…"
            placeholderTextColor={C.text3}
          />
          <Text style={styles.label}>Avoid (optional)</Text>
          <TextInput
            style={styles.negative}
            value={negativePrompt}
            onChangeText={setNegativePrompt}
            editable={!busy}
            maxLength={1000}
            placeholder="blurry, distorted, text"
            placeholderTextColor={C.text3}
          />

          <Text style={styles.label}>Quality</Text>
          <View style={styles.presets}>
            {PRESETS.map((preset) => (
              <Pressable
                key={preset.steps}
                style={[styles.preset, steps === preset.steps && styles.presetOn]}
                onPress={() => setSteps(preset.steps)}
                disabled={busy}
                accessibilityRole="button"
                accessibilityState={{ selected: steps === preset.steps, disabled: busy }}
                accessibilityLabel={`${preset.label}, ${preset.steps} steps`}
              >
                <Text style={[styles.presetLabel, steps === preset.steps && { color: C.accent }]}>{preset.label}</Text>
                <Text style={styles.presetSteps}>{preset.steps} steps</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.estimate}>Phone speed and temperature vary; the first measured SDXL run will establish the real timing.</Text>

          <View style={styles.seedRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Seed</Text>
              <Text style={styles.seedValue}>{seed}</Text>
            </View>
            <Pressable
              style={styles.randomButton}
              onPress={() => setSeed(Math.floor(Math.random() * 2_147_483_647))}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Choose a random seed"
            >
              <Ionicons name="shuffle" size={17} color={C.accent} />
              <Text style={styles.randomText}>Random</Text>
            </Pressable>
          </View>

          {generating && (
            <View style={styles.progressCard}>
              <View style={styles.progressTop}>
                <Text style={styles.progressLabel}>{progressLabel(progress)}</Text>
                <Text style={styles.progressPct}>{Math.round(fraction * 100)}%</Text>
              </View>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${Math.round(fraction * 100)}%` }]} />
              </View>
              <Text style={styles.progressHint}>Chat is unloaded while Quartz creates the image, then restored automatically.</Text>
            </View>
          )}

          {result && (
            <View style={styles.resultCard}>
              <Image
                source={{ uri: result.uri }}
                style={styles.resultImage}
                contentFit="contain"
                transition={150}
                accessibilityLabel="Image generated on this phone"
              />
              <View style={styles.resultBottom}>
                <Ionicons name="checkmark-circle" size={17} color={C.green} />
                <Text style={styles.resultMeta}>
                  Saved on phone · {result.steps} steps · {result.elapsedSeconds.toFixed(1)}s
                </Text>
              </View>
            </View>
          )}

          {generating ? (
            <Pressable style={[styles.cancelButton, cancelling && styles.disabled]} onPress={() => { void cancel(); }} disabled={cancelling} accessibilityRole="button">
              <Ionicons name="stop-circle-outline" size={19} color={C.red} />
              <Text style={styles.cancelText}>{cancelling ? "Stopping…" : "Cancel generation"}</Text>
            </Pressable>
          ) : (
            <Pressable style={[styles.generateButton, (!prompt.trim() || !status.active) && styles.disabled]} onPress={() => { void generate(); }} disabled={!prompt.trim() || !status.active} accessibilityRole="button">
              <Ionicons name={status.active ? "sparkles" : "power"} size={19} color={C.bg} />
              <Text style={styles.generateText}>{status.active ? "Generate on phone" : "Activate in Models"}</Text>
            </Pressable>
          )}
        </>
      )}

      <Text style={styles.foot}>
        No ONNX Runtime and no cloud inference. Quartz owns model parsing, tokenization, scheduling, operators, memory and Vulkan dispatch.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  h1: { color: C.text, fontSize: 24, fontWeight: "800" },
  sub: { color: C.text2, fontSize: 13, marginTop: 3 },
  state: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, height: 30 },
  stateReady: { borderColor: C.green, backgroundColor: "rgba(54,211,153,0.08)" },
  stateWaiting: { borderColor: C.amber, backgroundColor: "rgba(245,179,66,0.08)" },
  setupCard: { alignItems: "center", padding: 22, backgroundColor: C.bg2, borderRadius: 16, borderWidth: 1, borderColor: C.border },
  setupIcon: { width: 72, height: 72, alignItems: "center", justifyContent: "center", borderRadius: 22, backgroundColor: C.bg3, marginBottom: 14 },
  setupTitle: { color: C.text, fontSize: 18, fontWeight: "800", textAlign: "center" },
  setupText: { color: C.text2, fontSize: 13, lineHeight: 20, textAlign: "center", marginTop: 8 },
  setupMeta: { color: C.text3, fontSize: 11, fontFamily: "monospace", marginTop: 10 },
  primary: { width: "100%", minHeight: 48, backgroundColor: C.accent, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 18 },
  primaryText: { color: C.bg, fontSize: 14, fontWeight: "800" },
  downloadProgress: { width: "100%", marginTop: 12 },
  downloadFile: { color: C.text3, fontSize: 10, marginTop: 7, textAlign: "center" },
  downloadCancel: { alignSelf: "center", minHeight: 38, justifyContent: "center", marginTop: 6, paddingHorizontal: 12 },
  licenseButton: { marginTop: 12, minHeight: 32, justifyContent: "center" },
  licenseText: { color: C.text3, fontSize: 10, textDecorationLine: "underline" },
  statusMessage: { color: C.text3, fontSize: 11, textAlign: "center", marginTop: 12 },
  modelCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: C.bg2, borderWidth: 1, borderColor: C.green, borderRadius: 12, padding: 14, marginBottom: 18 },
  modelName: { color: C.text, fontSize: 14, fontWeight: "700" },
  modelMeta: { color: C.text3, fontSize: 11, marginTop: 3 },
  inactiveNotice: { flexDirection: "row", alignItems: "center", gap: 9, borderWidth: 1, borderColor: C.amber, backgroundColor: "rgba(245,179,66,0.07)", borderRadius: 10, padding: 12, marginBottom: 14 },
  inactiveText: { flex: 1, color: C.text2, fontSize: 12, lineHeight: 17 },
  label: { color: C.text2, fontSize: 12, fontWeight: "700", marginBottom: 7, marginTop: 12 },
  prompt: { minHeight: 104, color: C.text, backgroundColor: C.bg2, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 13, fontSize: 14, textAlignVertical: "top" },
  negative: { height: 48, color: C.text, backgroundColor: C.bg2, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 13, fontSize: 13 },
  presets: { flexDirection: "row", gap: 7 },
  preset: { flex: 1, minHeight: 58, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: C.bg2, borderWidth: 1, borderColor: C.border },
  presetOn: { borderColor: C.accent, backgroundColor: "rgba(124,92,255,0.10)" },
  presetLabel: { color: C.text2, fontSize: 12, fontWeight: "700" },
  presetSteps: { color: C.text3, fontSize: 9, marginTop: 3 },
  estimate: { color: C.text3, fontSize: 10, marginTop: 7 },
  seedRow: { flexDirection: "row", alignItems: "flex-end", marginTop: 6 },
  seedValue: { color: C.text, fontFamily: "monospace", fontSize: 14 },
  randomButton: { height: 38, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 9, backgroundColor: C.bg2, borderWidth: 1, borderColor: C.border },
  randomText: { color: C.accent, fontSize: 12, fontWeight: "700" },
  progressCard: { marginTop: 18, backgroundColor: C.bg2, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 14 },
  progressTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  progressLabel: { color: C.text, fontSize: 13, fontWeight: "700" },
  progressPct: { color: C.accent, fontSize: 12, fontFamily: "monospace" },
  track: { height: 7, backgroundColor: C.bg3, borderRadius: 4, overflow: "hidden", marginTop: 10 },
  fill: { height: 7, backgroundColor: C.accent, borderRadius: 4 },
  progressHint: { color: C.text3, fontSize: 10, lineHeight: 15, marginTop: 9 },
  resultCard: { marginTop: 18, overflow: "hidden", backgroundColor: C.bg2, borderWidth: 1, borderColor: C.border, borderRadius: 14 },
  resultImage: { width: "100%", aspectRatio: 1, backgroundColor: C.bg3 },
  resultBottom: { flexDirection: "row", alignItems: "center", gap: 7, padding: 12 },
  resultMeta: { color: C.text2, fontSize: 11, flex: 1 },
  generateButton: { minHeight: 52, marginTop: 18, borderRadius: 13, backgroundColor: C.accent, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  generateText: { color: C.bg, fontSize: 15, fontWeight: "800" },
  cancelButton: { minHeight: 50, marginTop: 18, borderRadius: 13, borderWidth: 1, borderColor: C.red, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  cancelText: { color: C.red, fontSize: 14, fontWeight: "700" },
  foot: { color: C.text3, fontSize: 11, lineHeight: 17, textAlign: "center", marginTop: 20 },
  disabled: { opacity: 0.45 },
});
