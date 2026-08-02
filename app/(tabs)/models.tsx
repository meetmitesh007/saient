import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  type ModelEntry,
  type DownloadHandle,
  type DownloadedModelCandidate,
  fetchCatalog,
  listLocal,
  getActive,
  setActive,
  downloadModel,
  discardDownloadedModelCandidates,
  importDownloadedModel,
  searchDownloadsForModels,
  deleteModel,
  isEnginePaused,
  setEnginePaused,
  fmtBytes,
} from "@/lib/models";
import { recommendModelCapability, type DeviceProfile } from "@/lib/model-capability";
import { quartzReady } from "@/lib/quartz";
import { C } from "@/lib/theme";
import { getDeviceProfile } from "@/modules/saient-device";
import {
  addDiffusionDownloadProgressListener,
  cancelDiffusionModelDownload,
  diffusionAvailable,
  downloadDiffusionModel,
  getDiffusionStatus,
  setDiffusionModelActive,
  type DiffusionDownloadProgress,
  type DiffusionStatus,
} from "@/modules/saient-diffusion";

export default function ModelsScreen() {
  const insets = useSafeAreaInsets();
  const [engineUp, setEngineUp] = useState<boolean | null>(null);
  const [paused, setPaused] = useState(false);
  const [pauseBusy, setPauseBusy] = useState(false);
  const [catalog, setCatalog] = useState<ModelEntry[]>([]);
  const [local, setLocal] = useState<Record<string, number>>({});
  const [active, setActiveState] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [handles, setHandles] = useState<Record<string, DownloadHandle>>({});
  const [downloadCandidates, setDownloadCandidates] = useState<DownloadedModelCandidate[]>([]);
  const [searchSummary, setSearchSummary] = useState("");
  const [searching, setSearching] = useState(false);
  const [importingUri, setImportingUri] = useState<string | null>(null);
  const [testingDevice, setTestingDevice] = useState(false);
  const [deviceProfile, setDeviceProfile] = useState<DeviceProfile | null>(null);
  const [imageStatus, setImageStatus] = useState<DiffusionStatus | null>(null);
  const [imageChecking, setImageChecking] = useState(true);
  const [imageDownloading, setImageDownloading] = useState(false);
  const [imageCancelling, setImageCancelling] = useState(false);
  const [imageStateBusy, setImageStateBusy] = useState(false);
  const [imageProgress, setImageProgress] = useState<DiffusionDownloadProgress | null>(null);
  const candidatesRef = useRef<DownloadedModelCandidate[]>([]);

  const refresh = useCallback(async () => {
    const [loc, act] = await Promise.all([listLocal(), getActive()]);
    setLocal(loc);
    setActiveState(act);
  }, []);

  const refreshImage = useCallback(async () => {
    if (!diffusionAvailable()) {
      setImageChecking(false);
      return;
    }
    setImageChecking(true);
    try {
      setImageStatus(await getDiffusionStatus());
    } catch (error) {
      setImageStatus({
        available: false,
        installed: false,
        valid: false,
        active: false,
        modelBytes: 0,
        message: String(error),
      });
    } finally {
      setImageChecking(false);
    }
  }, []);

  useEffect(() => {
    fetchCatalog().then(setCatalog);
    refresh();
    // Poll engine status: the supervisor brings it up a few seconds after a model lands,
    // so a one-shot check would leave the banner stale.
    const check = () => {
      quartzReady().then(setEngineUp);
      isEnginePaused().then(setPaused);
    };
    check();
    const t = setInterval(check, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    const subscription = diffusionAvailable()
      ? addDiffusionDownloadProgressListener(setImageProgress)
      : null;
    return () => subscription?.remove();
  }, [refreshImage]);

  useFocusEffect(useCallback(() => {
    void refresh();
    void refreshImage();
  }, [refresh, refreshImage]));

  useEffect(() => {
    candidatesRef.current = downloadCandidates;
  }, [downloadCandidates]);

  useEffect(() => () => {
    void discardDownloadedModelCandidates(candidatesRef.current);
  }, []);

  const onDownload = useCallback(
    async (m: ModelEntry) => {
      setProgress((p) => ({ ...p, [m.id]: 0 }));
      let last = 0;
      const handle = downloadModel(m, (frac) => {
        if (frac - last >= 0.01 || frac >= 1) {
          last = frac;
          setProgress((p) => ({ ...p, [m.id]: frac }));
        }
      });
      setHandles((h) => ({ ...h, [m.id]: handle }));
      try {
        const uri = await handle.promise;
        if (uri) {
          if (!(await getActive())) await setActive(m.file); // first model becomes active
        }
      } catch {
        /* cancelled or failed */
      } finally {
        setProgress((p) => { const n = { ...p }; delete n[m.id]; return n; });
        setHandles((h) => { const n = { ...h }; delete n[m.id]; return n; });
        await refresh();
        quartzReady().then(setEngineUp);
      }
    },
    [refresh],
  );

  const onCancel = useCallback((id: string) => handles[id]?.cancel(), [handles]);

  const onDownloadImage = useCallback(async () => {
    setImageDownloading(true);
    setImageProgress(null);
    try {
      setImageStatus(await downloadDiffusionModel());
      Alert.alert("Image model ready", "Quartz verified and activated the SDXL FP16 pack.");
    } catch (error) {
      if (!String(error).toLocaleLowerCase().includes("cancel")) {
        Alert.alert("Could not download image model", String(error));
      }
      await refreshImage();
    } finally {
      setImageDownloading(false);
      setImageCancelling(false);
    }
  }, [refreshImage]);

  const onCancelImageDownload = useCallback(async () => {
    setImageCancelling(true);
    try {
      await cancelDiffusionModelDownload();
    } finally {
      setImageCancelling(false);
    }
  }, []);

  const onSetImageActive = useCallback(async (nextActive: boolean) => {
    setImageStateBusy(true);
    try {
      setImageStatus(await setDiffusionModelActive(nextActive));
    } catch (error) {
      Alert.alert("Could not change image model", String(error));
    } finally {
      setImageStateBusy(false);
    }
  }, []);
  const onUseFile = useCallback(async (fileName: string) => {
    try {
      await setActive(fileName);
      await refresh();
    } catch (error) {
      Alert.alert("Could not use model", String(error));
    }
  }, [refresh]);
  const onDeleteFile = useCallback(async (fileName: string) => {
    try {
      await deleteModel(fileName);
      await refresh();
    } catch (error) {
      Alert.alert("Could not delete model", String(error));
    }
  }, [refresh]);
  const onUse = useCallback(async (m: ModelEntry) => { await onUseFile(m.file); }, [onUseFile]);
  const onDelete = useCallback(async (m: ModelEntry) => { await onDeleteFile(m.file); }, [onDeleteFile]);

  const onSearchDownloads = useCallback(async () => {
    setSearching(true);
    try {
      await discardDownloadedModelCandidates(downloadCandidates);
      setDownloadCandidates([]);
      setSearchSummary("");
      const result = await searchDownloadsForModels();
      if (!result) return;
      setDownloadCandidates(result.models);
      const details = [
        `${result.models.length} GGUF ${result.models.length === 1 ? "model" : "models"} found`,
        result.rejectedFiles > 0 ? `${result.rejectedFiles} invalid or incomplete skipped` : "",
      ].filter(Boolean).join(" · ");
      setSearchSummary(details);
      if (result.models.length === 0) {
        Alert.alert(
          "No usable GGUF models found",
          result.rejectedFiles > 0
            ? `Saient skipped ${result.rejectedFiles} incomplete or invalid .gguf ${result.rejectedFiles === 1 ? "file" : "files"}.`
            : "Put a complete .gguf model in Downloads, then search again.",
        );
      }
    } catch (error) {
      Alert.alert("Could not search Downloads", String(error));
    } finally {
      setSearching(false);
    }
  }, [downloadCandidates]);

  const onImport = useCallback(async (candidate: DownloadedModelCandidate) => {
    setImportingUri(candidate.sourceUri);
    try {
      const imported = await importDownloadedModel(candidate);
      const currentActive = await getActive();
      if (!currentActive) await setActive(imported.fileName);
      await refresh();
      setDownloadCandidates((current) => current.filter((item) => item.sourceUri !== candidate.sourceUri));
      setSearchSummary("");

      if (!currentActive) {
        Alert.alert("Model imported", `“${imported.fileName}” is now active in Quartz.`);
      } else {
        Alert.alert(
          "Model imported",
          `“${imported.fileName}” was copied into Saient. Use it now?`,
          [
            { text: "Later", style: "cancel" },
            { text: "Use model", onPress: () => { void onUseFile(imported.fileName); } },
          ],
        );
      }
    } catch (error) {
      await discardDownloadedModelCandidates([candidate]);
      setDownloadCandidates((current) => current.filter((item) => item.sourceUri !== candidate.sourceUri));
      setSearchSummary("");
      Alert.alert("Could not import model", String(error));
    } finally {
      setImportingUri(null);
    }
  }, [onUseFile, refresh]);

  const onTestDevice = useCallback(async () => {
    setTestingDevice(true);
    try {
      const profile = await getDeviceProfile();
      if (!profile) {
        Alert.alert("Device test unavailable", "This build does not include the local device profile module.");
        return;
      }
      setDeviceProfile(profile);
    } catch (error) {
      Alert.alert("Could not test this device", String(error));
    } finally {
      setTestingDevice(false);
    }
  }, []);

  const onUnload = useCallback(async () => {
    setPauseBusy(true);
    try {
      await setEnginePaused(true);
      setPaused(true);
      setEngineUp(false); // reflect immediately; the engine goes down within a supervisor poll
    } catch (error) {
      Alert.alert("Could not unload the model", String(error));
    } finally {
      setPauseBusy(false);
    }
  }, []);

  const onResume = useCallback(async () => {
    setPauseBusy(true);
    try {
      await setEnginePaused(false);
      setPaused(false); // the supervisor reloads the engine within a poll cycle; banner catches up
    } catch (error) {
      Alert.alert("Could not load the model", String(error));
    } finally {
      setPauseBusy(false);
    }
  }, []);

  const totalBytes = Object.values(local).reduce((a, b) => a + b, 0) + (imageStatus?.installed ? imageStatus.modelBytes : 0);
  const hasModel = Object.keys(local).length > 0;
  const catalogFiles = new Set(catalog.map((model) => model.file));
  const importedModels = Object.entries(local).filter(([fileName]) => !catalogFiles.has(fileName));
  const capability = deviceProfile ? recommendModelCapability(deviceProfile) : null;
  const imageDownloadFraction = imageProgress && imageProgress.totalBytes > 0
    ? imageProgress.completedBytes / imageProgress.totalBytes
    : 0;

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: 16, paddingTop: insets.top + 8, paddingBottom: 40 }}>
      <Text style={styles.h1}>Models</Text>
      <Text style={styles.sub}>Download a model to run entirely on this phone. Nothing leaves your device.</Text>

      <View style={styles.quartzBanner} accessibilityRole="summary">
        <Ionicons name="hardware-chip" size={19} color={C.accent} />
        <Text style={styles.quartzBannerText}>
          Native image generation through Quartz — Saient’s own Vulkan inference runtime. No cloud. No ONNX.
        </Text>
      </View>

      <View style={[styles.engine, { borderColor: paused ? C.amber : engineUp ? C.green : C.amber }, paused && { marginBottom: 8 }]}>
        <Ionicons
          name={paused ? "battery-charging-outline" : engineUp ? "flash" : "construct"}
          size={16}
          color={paused ? C.amber : engineUp ? C.green : C.amber}
        />
        <Text style={[styles.engineText, { flex: 1 }]}>
          {paused
            ? "Engine off to save battery"
            : engineUp === null
              ? "Checking Quartz engine…"
              : engineUp
                ? "Quartz engine ready"
                : "No model loaded yet — download one below"}
        </Text>
        {hasModel && paused ? (
          <Pressable
            style={[styles.engineBtn, pauseBusy && styles.disabled]}
            onPress={() => { void onResume(); }}
            disabled={pauseBusy}
            accessibilityRole="button"
            accessibilityLabel="Load model"
          >
            <Ionicons name="play" size={13} color={C.accent} />
            <Text style={styles.engineBtnText}>Load</Text>
          </Pressable>
        ) : hasModel && engineUp ? (
          <Pressable
            style={[styles.engineBtn, pauseBusy && styles.disabled]}
            onPress={() => { void onUnload(); }}
            disabled={pauseBusy}
            accessibilityRole="button"
            accessibilityLabel="Unload model to save battery"
          >
            <Ionicons name="power" size={13} color={C.text2} />
            <Text style={[styles.engineBtnText, { color: C.text2 }]}>Unload</Text>
          </Pressable>
        ) : null}
      </View>
      {paused && (
        <Text style={styles.pausedHint}>Model unloaded to free memory and battery. Tap Load to chat again.</Text>
      )}

      <Text style={styles.sectionTitle}>Curated models</Text>
      {catalog.map((m) => {
        const downloaded = local[m.file] != null;
        const isActive = active === m.file;
        const frac = progress[m.id];
        const downloading = frac != null;
        return (
          <View key={m.id} style={[styles.card, isActive && { borderColor: C.green }]}>
            <View style={styles.cardTop}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardName}>{m.name}</Text>
                <Text style={styles.cardMeta}>{m.params} · {m.quant} · {fmtBytes(m.sizeBytes)} · {m.tier}</Text>
                {!!m.desc && <Text style={styles.cardDesc}>{m.desc}</Text>}
                <Text style={styles.license}>{m.license}</Text>
              </View>
              {!downloading && !downloaded && (
                <Pressable style={styles.action} onPress={() => onDownload(m)}>
                  <Ionicons name="download-outline" size={18} color={C.accent} />
                  <Text style={styles.actionText}>Get</Text>
                </Pressable>
              )}
              {!downloading && downloaded && !isActive && (
                <Pressable style={styles.action} onPress={() => onUse(m)}>
                  <Text style={styles.actionText}>Use</Text>
                </Pressable>
              )}
              {!downloading && downloaded && isActive && (
                <View style={[styles.action, styles.activeChip]}>
                  <Ionicons name="checkmark-circle" size={16} color={C.green} />
                  <Text style={[styles.actionText, { color: C.green }]}>Active</Text>
                </View>
              )}
              {downloading && (
                <Pressable style={styles.action} onPress={() => onCancel(m.id)}>
                  <Ionicons name="close" size={18} color={C.text2} />
                </Pressable>
              )}
            </View>

            {downloading && (
              <View style={styles.progressRow}>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${Math.round(frac * 100)}%` }]} />
                </View>
                <Text style={styles.progressPct}>{Math.round(frac * 100)}%</Text>
              </View>
            )}

            {downloaded && !downloading && (
              <Pressable style={styles.delete} onPress={() => onDelete(m)} hitSlop={8}>
                <Ionicons name="trash-outline" size={14} color={C.text3} />
                <Text style={styles.deleteText}>Delete</Text>
              </Pressable>
            )}
          </View>
        );
      })}

      <Text style={styles.sectionTitle}>Image models</Text>
      <View style={[styles.card, imageStatus?.active && { borderColor: C.green }]}>
        <View style={styles.cardTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardName}>Saient SDXL FP16</Text>
            <Text style={styles.cardMeta}>
              {imageStatus?.valid && imageStatus.modelBytes ? fmtBytes(imageStatus.modelBytes) : "6.94 GB"} · FP16 · Vulkan
            </Text>
            <Text style={styles.cardDesc}>Native 1024×1024 SDXL generation. Quartz loads it only while generating.</Text>
            <Text style={styles.license}>SDXL OpenRAIL++ · FP16-fix VAE MIT</Text>
          </View>
          {!imageDownloading && !imageStatus?.valid && (
            <Pressable
              style={[styles.action, (imageChecking || !imageStatus?.available) && styles.disabled]}
              onPress={() => { void onDownloadImage(); }}
              disabled={imageChecking || !imageStatus?.available}
              accessibilityRole="button"
              accessibilityLabel="Download Saient SDXL image model"
            >
              <Ionicons name="download-outline" size={18} color={C.accent} />
              <Text style={styles.actionText}>{imageChecking ? "Checking" : "Get"}</Text>
            </Pressable>
          )}
          {!imageDownloading && imageStatus?.valid && !imageStatus.active && (
            <Pressable
              style={[styles.action, imageStateBusy && styles.disabled]}
              onPress={() => { void onSetImageActive(true); }}
              disabled={imageStateBusy}
              accessibilityRole="button"
              accessibilityLabel="Activate SDXL image model"
            >
              <Ionicons name="play" size={16} color={C.accent} />
              <Text style={styles.actionText}>Activate</Text>
            </Pressable>
          )}
          {!imageDownloading && imageStatus?.valid && imageStatus.active && (
            <View style={[styles.action, styles.activeChip]}>
              <Ionicons name="checkmark-circle" size={16} color={C.green} />
              <Text style={[styles.actionText, { color: C.green }]}>Active</Text>
            </View>
          )}
          {imageDownloading && (
            <Pressable
              style={[styles.action, imageCancelling && styles.disabled]}
              onPress={() => { void onCancelImageDownload(); }}
              disabled={imageCancelling}
              accessibilityRole="button"
              accessibilityLabel="Cancel SDXL model download"
            >
              <Ionicons name="close" size={18} color={C.text2} />
            </Pressable>
          )}
        </View>

        {imageDownloading && (
          <View style={styles.progressRow}>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.round(imageDownloadFraction * 100)}%` }]} />
            </View>
            <Text style={styles.progressPct}>{Math.round(imageDownloadFraction * 100)}%</Text>
          </View>
        )}

        {imageStatus?.valid && imageStatus.active && !imageDownloading && (
          <Pressable
            style={[styles.delete, imageStateBusy && styles.disabled]}
            onPress={() => { void onSetImageActive(false); }}
            disabled={imageStateBusy}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Deactivate SDXL image model"
          >
            <Ionicons name="power" size={14} color={C.text3} />
            <Text style={styles.deleteText}>Deactivate to block image inference</Text>
          </Pressable>
        )}
        {imageStatus?.valid && !imageStatus.active && (
          <Text style={styles.inactiveHint}>Inactive — installed files remain, but Quartz will not start image inference.</Text>
        )}
        {!!imageStatus?.message && !imageStatus.valid && !imageDownloading && (
          <Text style={styles.inactiveHint}>{imageStatus.message}</Text>
        )}
      </View>

      {importedModels.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Imported models</Text>
          {importedModels.map(([fileName, sizeBytes]) => {
            const isActive = active === fileName;
            return (
              <View key={fileName} style={[styles.card, isActive && { borderColor: C.green }]}>
                <View style={styles.cardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardName} numberOfLines={2}>{fileName}</Text>
                    <Text style={styles.cardMeta}>{fmtBytes(sizeBytes)} · Local GGUF</Text>
                    <Text style={styles.cardDesc}>Imported from Downloads</Text>
                  </View>
                  {!isActive ? (
                    <Pressable style={styles.action} onPress={() => { void onUseFile(fileName); }}>
                      <Text style={styles.actionText}>Use</Text>
                    </Pressable>
                  ) : (
                    <View style={[styles.action, styles.activeChip]}>
                      <Ionicons name="checkmark-circle" size={16} color={C.green} />
                      <Text style={[styles.actionText, { color: C.green }]}>Active</Text>
                    </View>
                  )}
                </View>
                <Pressable style={styles.delete} onPress={() => { void onDeleteFile(fileName); }} hitSlop={8}>
                  <Ionicons name="trash-outline" size={14} color={C.text3} />
                  <Text style={styles.deleteText}>Delete</Text>
                </Pressable>
              </View>
            );
          })}
        </>
      )}

      <Text style={styles.storage}>
        {totalBytes > 0 ? `${fmtBytes(totalBytes)} of models on this device` : "No models downloaded yet"}
      </Text>

      <View style={styles.moreDivider} />
      <Text style={styles.moreTitle}>More options</Text>

      <View style={styles.importPanel}>
        <View style={styles.importCopy}>
          <Text style={styles.importTitle}>Already downloaded a model?</Text>
          <Text style={styles.importText}>Open Android&apos;s file search, choose a complete GGUF from Downloads, then copy it into Saient.</Text>
        </View>
        <Pressable
          style={[styles.searchButton, searching && styles.disabled]}
          onPress={() => { void onSearchDownloads(); }}
          disabled={searching || importingUri != null}
          accessibilityRole="button"
          accessibilityLabel="Search Downloads for GGUF models"
        >
          <Ionicons name={searching ? "hourglass-outline" : "search"} size={17} color={C.accent} />
          <Text style={styles.searchButtonText}>{searching ? "Searching…" : "Search Downloads"}</Text>
        </Pressable>
      </View>
      {!!searchSummary && <Text style={styles.searchSummary}>{searchSummary}</Text>}
      {downloadCandidates.map((candidate) => {
        const importing = importingUri === candidate.sourceUri;
        return (
          <View key={candidate.sourceUri} style={styles.downloadCandidate}>
            <View style={{ flex: 1 }}>
              <Text style={styles.candidateName} numberOfLines={2}>{candidate.fileName}</Text>
              <Text style={styles.cardMeta}>{fmtBytes(candidate.sizeBytes)} · GGUF v{candidate.ggufVersion}</Text>
            </View>
            <Pressable
              style={[styles.action, importing && styles.disabled]}
              onPress={() => { void onImport(candidate); }}
              disabled={importingUri != null}
              accessibilityRole="button"
              accessibilityLabel={`Import ${candidate.fileName}`}
            >
              <Ionicons name={importing ? "hourglass-outline" : "download-outline"} size={17} color={C.accent} />
              <Text style={styles.actionText}>{importing ? "Copying…" : "Import"}</Text>
            </Pressable>
          </View>
        );
      })}

      <View style={styles.deviceTest}>
        <View style={styles.deviceHeader}>
          <Ionicons name="hardware-chip-outline" size={18} color={C.accent} />
          <Text style={styles.deviceTitle}>Device model test</Text>
        </View>
        <Text style={styles.deviceText}>
          Check this phone&apos;s real memory and CPU, then get a conservative GGUF size recommendation. The test stays on-device.
        </Text>
        {deviceProfile && capability && (
          <View style={styles.deviceResult}>
            <Text style={styles.recommendation}>Recommended: {capability.tier}</Text>
            <Text style={styles.resultText}>{capability.parameters} · up to about {fmtBytes(capability.maxModelBytes)}</Text>
            <Text style={styles.resultText}>{capability.quantization}</Text>
            <Text style={styles.deviceFacts}>
              {fmtBytes(deviceProfile.totalMemoryBytes)} RAM · {deviceProfile.logicalCores} CPU cores · {deviceProfile.architecture}
            </Text>
            {deviceProfile.availableMemoryBytes != null && (
              <Text style={[styles.deviceFacts, capability.underMemoryPressure && { color: C.amber }]}>
                {fmtBytes(deviceProfile.availableMemoryBytes)} available now
                {capability.underMemoryPressure ? " — close other apps before loading a model" : ""}
              </Text>
            )}
            <Text style={styles.caveat}>Guidance only: model architecture, quantization and context length also affect compatibility and memory use.</Text>
          </View>
        )}
        <Pressable
          style={[styles.testButton, testingDevice && styles.disabled]}
          onPress={() => { void onTestDevice(); }}
          disabled={testingDevice}
          accessibilityRole="button"
          accessibilityLabel="Test this device for model size"
        >
          <Ionicons name={testingDevice ? "hourglass-outline" : "speedometer-outline"} size={17} color={C.bg} />
          <Text style={styles.testButtonText}>{testingDevice ? "Testing…" : deviceProfile ? "Test again" : "Test this device"}</Text>
        </Pressable>
      </View>

      <Text style={styles.note}>
        Curated models are open-licensed (Apache-2.0); see Settings → Open-source notices.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  h1: { color: C.text, fontSize: 24, fontWeight: "800" },
  sub: { color: C.text2, fontSize: 14, marginTop: 4, marginBottom: 16 },
  quartzBanner: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 13, borderWidth: 1, borderColor: C.accent, borderRadius: 11, backgroundColor: C.bg2, marginBottom: 14 },
  quartzBannerText: { flex: 1, color: C.text, fontSize: 13, lineHeight: 19, fontWeight: "600" },
  engine: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderWidth: 1, borderRadius: 10, backgroundColor: C.bg2, marginBottom: 16 },
  engineText: { color: C.text2, fontSize: 13 },
  engineBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, height: 30, borderRadius: 8, borderWidth: 1, borderColor: C.border, backgroundColor: C.bg3 },
  engineBtnText: { color: C.accent, fontSize: 12, fontWeight: "700" },
  pausedHint: { color: C.text3, fontSize: 12, lineHeight: 17, marginBottom: 16 },
  importPanel: { padding: 14, backgroundColor: C.bg2, borderWidth: 1, borderColor: C.border, borderRadius: 12, marginBottom: 10 },
  importCopy: { marginBottom: 12 },
  importTitle: { color: C.text, fontSize: 14, fontWeight: "700" },
  importText: { color: C.text2, fontSize: 12, lineHeight: 18, marginTop: 4 },
  searchButton: { minHeight: 42, borderRadius: 10, borderWidth: 1, borderColor: C.accent, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  searchButtonText: { color: C.accent, fontSize: 13, fontWeight: "700" },
  searchSummary: { color: C.text3, fontSize: 11, marginBottom: 10 },
  downloadCandidate: { padding: 12, backgroundColor: C.bg2, borderWidth: 1, borderColor: C.border, borderRadius: 10, marginBottom: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  candidateName: { color: C.text, fontSize: 13, fontWeight: "600" },
  disabled: { opacity: 0.5 },
  sectionTitle: { color: C.text2, fontSize: 13, fontWeight: "700", marginTop: 10, marginBottom: 8 },
  moreDivider: { height: 1, backgroundColor: C.border, marginTop: 26 },
  moreTitle: { color: C.text3, fontSize: 12, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase", marginTop: 14, marginBottom: 10 },
  card: { padding: 14, backgroundColor: C.bg2, borderWidth: 1, borderColor: C.border, borderRadius: 12, marginBottom: 10 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  cardName: { color: C.text, fontSize: 15, fontWeight: "700" },
  cardMeta: { color: C.accent, fontSize: 11, fontFamily: "monospace", marginTop: 2 },
  cardDesc: { color: C.text2, fontSize: 13, marginTop: 4 },
  license: { color: C.text3, fontSize: 11, marginTop: 4 },
  action: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 14, height: 38, borderRadius: 10, backgroundColor: C.bg3, borderWidth: 1, borderColor: C.border },
  actionText: { color: C.accent, fontSize: 13, fontWeight: "700" },
  activeChip: { backgroundColor: "transparent", borderColor: C.green },
  progressRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12 },
  progressTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: C.bg3, overflow: "hidden" },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: C.accent },
  progressPct: { color: C.text2, fontSize: 12, fontFamily: "monospace", width: 40, textAlign: "right" },
  delete: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 10, alignSelf: "flex-start" },
  deleteText: { color: C.text3, fontSize: 12 },
  inactiveHint: { color: C.text3, fontSize: 11, lineHeight: 16, marginTop: 10 },
  storage: { color: C.text3, fontSize: 12, marginTop: 8 },
  note: { color: C.text3, fontSize: 12, lineHeight: 18, marginTop: 18 },
  deviceTest: { padding: 14, backgroundColor: C.bg2, borderWidth: 1, borderColor: C.border, borderRadius: 12, marginTop: 18 },
  deviceHeader: { flexDirection: "row", alignItems: "center", gap: 7 },
  deviceTitle: { color: C.text, fontSize: 15, fontWeight: "700" },
  deviceText: { color: C.text2, fontSize: 12, lineHeight: 18, marginTop: 6 },
  deviceResult: { borderTopWidth: 1, borderTopColor: C.border, marginTop: 12, paddingTop: 12 },
  recommendation: { color: C.green, fontSize: 14, fontWeight: "700" },
  resultText: { color: C.text2, fontSize: 12, marginTop: 4 },
  deviceFacts: { color: C.text3, fontSize: 11, fontFamily: "monospace", marginTop: 6 },
  caveat: { color: C.text3, fontSize: 10, lineHeight: 15, marginTop: 8 },
  testButton: { minHeight: 42, borderRadius: 10, backgroundColor: C.accent, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, marginTop: 12 },
  testButtonText: { color: C.bg, fontSize: 13, fontWeight: "800" },
});
