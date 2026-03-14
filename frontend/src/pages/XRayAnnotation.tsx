import { useState, useRef, useCallback, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { ArrowLeft, Moon, Sun, Loader2 } from "lucide-react";
import { AnnotationToolbar, type AnnotationTool } from "@/components/xray/AnnotationToolbar";
import { ImageCanvas, type Annotation } from "@/components/xray/ImageCanvas";
import { ImageAdjustments } from "@/components/xray/ImageAdjustments";
import { ShapeDimensions } from "@/components/xray/ShapeDimensions";
import { AnnotationList } from "@/components/xray/AnnotationList";
import { MedicalButton } from "@/components/medical/MedicalButton";
import { useTheme } from "@/components/ThemeProvider";
import { toast } from "@/hooks/use-toast";
import { annotationsApi, autoAnnotateApi } from "@/services/api";

const XRayAnnotation = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Router state data
  const stateData = location.state as { imageSrc?: string; imageName?: string; patientId?: string } | null;

  // Image state
  const [imageSrc, setImageSrc] = useState<string | null>(stateData?.imageSrc || null);
  const [imageName, setImageName] = useState<string>(stateData?.imageName || "");
  const [patientId, setPatientId] = useState<string>(stateData?.patientId || "");

  // Tool state
  const [activeTool, setActiveTool] = useState<AnnotationTool>("select");
  const [isPanning, setIsPanning] = useState(false);

  // View state
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  // Initialize view when image is loaded from state
  useEffect(() => {
    if (stateData?.imageSrc) {
      const img = new Image();
      img.onload = () => {
        const containerWidth = window.innerWidth - 320;
        const containerHeight = window.innerHeight - 150;
        const scaleX = containerWidth / img.naturalWidth;
        const scaleY = containerHeight / img.naturalHeight;
        const fitZoom = Math.min(scaleX, scaleY, 1) * 0.85;

        setZoom(fitZoom);
        const centeredX = (containerWidth - img.naturalWidth * fitZoom) / 2;
        const centeredY = (containerHeight - img.naturalHeight * fitZoom) / 2;
        setPosition({ x: Math.max(20, centeredX), y: Math.max(20, centeredY) });
      };
      img.src = stateData.imageSrc;
    }
  }, [stateData]);

  // Callback for wheel zoom
  const handleWheelZoom = useCallback((newZoom: number) => {
    setZoom(newZoom);
  }, []);

  // Annotation state
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [selectedAnnotation, setSelectedAnnotation] = useState<string | null>(null);
  const [history, setHistory] = useState<Annotation[][]>([[]]);
  const [historyIndex, setHistoryIndex] = useState(0);

  // Image filter state
  const [filters, setFilters] = useState({
    brightness: 100,
    contrast: 100,
    gamma: 100,
    invert: false,
  });

  // Femoral detection state
  const [isDetecting, setIsDetecting] = useState(false);

  const resetFilters = useCallback(() => {
    setFilters({
      brightness: 100,
      contrast: 100,
      gamma: 100,
      invert: false,
    });
  }, []);

  // Get selected annotation object
  const getSelectedAnnotationObject = (): Annotation | null => {
    if (!selectedAnnotation) return null;
    return annotations.find((a) => a.id === selectedAnnotation) || null;
  };

  // Handle tool change - clear panning when switching to a non-pan tool
  const handleToolChange = useCallback((tool: AnnotationTool) => {
    setActiveTool(tool);
    // When switching to select or any drawing tool, ensure panning is disabled
    if (tool !== "select") {
      setIsPanning(false);
    }
  }, []);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key.toLowerCase()) {
        case "v":
          handleToolChange("select");
          break;
        case "p":
          handleToolChange("marker");
          break;
        case "b":
          handleToolChange("box");
          break;
        case "c":
          handleToolChange("circle");
          break;
        case "o":
          handleToolChange("ellipse");
          break;
        case "l":
          handleToolChange("line");
          break;
        case "d":
          handleToolChange("freehand");
          break;
        case "m":
          handleToolChange("ruler");
          break;
        case "a":
          handleToolChange("angle");
          break;
        case "t":
          handleToolChange("text");
          break;
        case "e":
          handleToolChange("eraser");
          break;
        case "+":
        case "=":
          handleZoomIn();
          break;
        case "-":
          handleZoomOut();
          break;
        case " ":
          e.preventDefault();
          setIsPanning(true);
          break;
        case "z":
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            if (e.shiftKey) {
              handleRedo();
            } else {
              handleUndo();
            }
          }
          break;
        case "delete":
        case "backspace":
          if (selectedAnnotation) {
            e.preventDefault();
            setAnnotations((prev) => prev.filter((a) => a.id !== selectedAnnotation));
            setSelectedAnnotation(null);
          }
          break;
        case "escape":
          handleToolChange("select");
          setIsPanning(false);
          break;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === " ") {
        setIsPanning(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [historyIndex, history, selectedAnnotation]);

  const handleUpload = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith("image/")) {
        toast({
          title: "Invalid file type",
          description: "Please upload an image file (JPEG, PNG, DICOM, etc.)",
          variant: "destructive",
        });
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        const imgData = event.target?.result as string;

        const img = new Image();
        img.onload = () => {
          const containerWidth = window.innerWidth - 320;
          const containerHeight = window.innerHeight - 150;

          const scaleX = containerWidth / img.naturalWidth;
          const scaleY = containerHeight / img.naturalHeight;
          const fitZoom = Math.min(scaleX, scaleY, 1) * 0.85;

          setImageSrc(imgData);
          setImageName(file.name);
          setZoom(fitZoom);
          const centeredX = (containerWidth - img.naturalWidth * fitZoom) / 2;
          const centeredY = (containerHeight - img.naturalHeight * fitZoom) / 2;
          setPosition({ x: Math.max(20, centeredX), y: Math.max(20, centeredY) });
          setAnnotations([]);
          setSelectedAnnotation(null);
          setHistory([[]]);
          setHistoryIndex(0);
          toast({
            title: "Image loaded",
            description: `${file.name} loaded at ${Math.round(fitZoom * 100)}% zoom.`,
          });
        };
        img.src = imgData;
      };
      reader.readAsDataURL(file);
    }
  };

  const handleZoomIn = useCallback(() => {
    setZoom((prev) => Math.min(prev * 1.2, 5));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((prev) => Math.max(prev / 1.2, 0.2));
  }, []);

  const handleAnnotationsChange = useCallback(
    (newAnnotations: Annotation[], skipHistory = false) => {
      setAnnotations(newAnnotations);
      if (!skipHistory) {
        const newHistory = history.slice(0, historyIndex + 1);
        newHistory.push(newAnnotations);
        setHistory(newHistory);
        setHistoryIndex(newHistory.length - 1);
      }
    },
    [history, historyIndex]
  );

  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setAnnotations(history[newIndex]);
      setSelectedAnnotation(null);
    }
  }, [historyIndex, history]);

  const handleRedo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      setAnnotations(history[newIndex]);
      setSelectedAnnotation(null);
    }
  }, [historyIndex, history]);

  const handleDeleteAnnotation = useCallback((id: string) => {
    setAnnotations((prev) => {
      const filtered = prev.filter((a) => a.id !== id);
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(filtered);
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
      return filtered;
    });
    if (selectedAnnotation === id) {
      setSelectedAnnotation(null);
    }
  }, [history, historyIndex, selectedAnnotation]);

  const handleLabelChange = useCallback((id: string, newLabel: string) => {
    setAnnotations((prev) =>
      prev.map((ann) => ann.id === id ? { ...ann, label: newLabel } : ann)
    );
  }, []);

  const handleToggleLock = useCallback((id: string) => {
    setAnnotations((prev) => {
      const updated = prev.map((ann) => ann.id === id ? { ...ann, locked: !ann.locked } : ann);
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(updated);
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
      return updated;
    });
  }, [history, historyIndex]);

  const handleSave = useCallback(async () => {
    if (!imageSrc) return;
    if (!patientId) {
      toast({
        title: "No patient selected",
        description: "Please start the annotation from a patient's details page to save records correctly.",
        variant: "destructive"
      });
      return;
    }

    try {
      await annotationsApi.save({
        patient_id: patientId,
        image_name: imageName,
        image_src: imageSrc,
        annotations: annotations
      });

      toast({
        title: "Annotations saved",
        description: `${annotations.length} annotation(s) saved for ${imageName}.`,
      });
      // Pass the patientId to correctly focus the view page
      navigate("/view", { state: { patientId } });
    } catch (err) {
      const isQuotaError = err instanceof Error && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED');
      toast({
        title: "Error",
        description: isQuotaError ? "Storage full. Try using a smaller image." : "Failed to save annotations to local storage.",
        variant: "destructive"
      });
    }
  }, [imageSrc, annotations, patientId, imageName, navigate]);

  const handlePanToggle = useCallback(() => {
    setIsPanning((prev) => !prev);
  }, []);

  // Auto Annotate: call femoral + endplates APIs and plot circles/lines
  const handleAutoAnnotate = useCallback(async () => {
    if (!imageSrc) {
      toast({
        title: "No image",
        description: "Please upload an X-ray image first.",
        variant: "destructive",
      });
      return;
    }

    setIsDetecting(true);
    try {
      // Get image dimensions for coordinate scaling
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = imageSrc;
      });
      const imgW = img.naturalWidth;
      const imgH = img.naturalHeight;

      // Call both APIs in parallel
      const [femoralHeads, endplatesResult] = await Promise.all([
        autoAnnotateApi.femoralHeads(imageSrc),
        autoAnnotateApi.endplates(imageSrc),
      ]);

      const newAnnotations: Annotation[] = [];
      const ts = Date.now();

      // Femoral heads → circle annotations (points = bounding box corners)
      femoralHeads.forEach((head: { cx: number; cy: number; rx: number; ry: number }, idx: number) => {
        const r = (head.rx + head.ry) / 2;
        newAnnotations.push({
          id: `auto_femoral_${ts}_${idx}`,
          type: "circle",
          points: [
            { x: head.cx - r, y: head.cy - r },
            { x: head.cx + r, y: head.cy + r },
          ],
          color: "#3b82f6",
          label: `Femoral head ${idx + 1}`,
        });
      });

      // Endplates → line annotations; scale if API image size differs
      const apiShape = endplatesResult.image_shape;
      const scaleX = apiShape ? imgW / apiShape.width : 1;
      const scaleY = apiShape ? imgH / apiShape.height : 1;

      (endplatesResult.endplates || [])
        .filter((ep: { detected?: boolean }) => ep.detected !== false)
        .forEach((ep: { label: string; x1: number; y1: number; x2: number; y2: number }, idx: number) => {
          const x1 = ep.x1 * scaleX;
          const y1 = ep.y1 * scaleY;
          const x2 = ep.x2 * scaleX;
          const y2 = ep.y2 * scaleY;
          newAnnotations.push({
            id: `auto_endplate_${ts}_${idx}`,
            type: "line",
            points: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
            color: "#f59e0b",
            label: ep.label,
          });
        });

      if (newAnnotations.length > 0) {
        handleAnnotationsChange([...annotations, ...newAnnotations]);
        toast({
          title: "Auto Annotate complete",
          description: `Added ${femoralHeads.length} femoral head(s) and ${(endplatesResult.endplates || []).filter((e: any) => e.detected !== false).length} endplate line(s).`,
        });
      } else {
        toast({
          title: "No detections",
          description: "No femoral heads or endplates detected in this image.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Auto annotate error:", error);
      toast({
        title: "Auto Annotate error",
        description: "Could not reach the detection APIs. Check your connection or try again.",
        variant: "destructive",
      });
    } finally {
      setIsDetecting(false);
    }
  }, [imageSrc, annotations, handleAnnotationsChange]);

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <header className="h-14 border-b border-border bg-card flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3">
          <MedicalButton
            variant="ghost"
            size="sm"
            onClick={() => navigate("/dashboard")}
            leftIcon={<ArrowLeft className="h-4 w-4" />}
          >
            Back
          </MedicalButton>
          <div className="h-6 w-px bg-border" />
          <h1 className="text-lg font-semibold text-foreground">X-Ray Annotation</h1>
          {imageName && (
            <>
              <div className="h-6 w-px bg-border" />
              <span className="text-sm text-muted-foreground truncate max-w-[200px]">
                {imageName}
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground hidden sm:block">
            {annotations.length} annotation{annotations.length !== 1 ? "s" : ""}
          </span>
          <MedicalButton
            variant="success"
            size="sm"
            onClick={handleSave}
            disabled={!imageSrc}
          >
            Save Annotations
          </MedicalButton>
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors focus-ring"
            aria-label="Toggle theme"
          >
            {theme === "light" ? (
              <Moon className="h-5 w-5" />
            ) : (
              <Sun className="h-5 w-5" />
            )}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />

        {/* Toolbar */}
        <AnnotationToolbar
          activeTool={activeTool}
          onToolChange={handleToolChange}
          onUpload={handleUpload}
          onUndo={handleUndo}
          onRedo={handleRedo}
          canUndo={historyIndex > 0}
          canRedo={historyIndex < history.length - 1}
          hasImage={!!imageSrc}
        />

        {/* Canvas */}
        <ImageCanvas
          imageSrc={imageSrc}
          activeTool={activeTool}
          zoom={zoom}
          position={position}
          isPanning={isPanning}
          annotations={annotations}
          filters={filters}
          onAnnotationsChange={handleAnnotationsChange}
          onPositionChange={setPosition}
          onZoomChange={handleWheelZoom}
          selectedAnnotation={selectedAnnotation}
          onSelectedAnnotationChange={setSelectedAnnotation}
          onToolChange={handleToolChange}
        />

        {/* Right Panel - Image Adjustments + Shape Dimensions + Annotation Labels */}
        <aside className="w-56 bg-card border-l border-border flex flex-col shadow-sm shrink-0 h-full overflow-hidden">
          <ImageAdjustments
            brightness={filters.brightness}
            contrast={filters.contrast}
            gamma={filters.gamma}
            invert={filters.invert}
            onBrightnessChange={(v) => setFilters((f) => ({ ...f, brightness: v }))}
            onContrastChange={(v) => setFilters((f) => ({ ...f, contrast: v }))}
            onGammaChange={(v) => setFilters((f) => ({ ...f, gamma: v }))}
            onInvertChange={(v) => setFilters((f) => ({ ...f, invert: v }))}
            onReset={() =>
              setFilters({
                brightness: 100,
                contrast: 100,
                gamma: 100,
                invert: false,
              })
            }
            hasImage={!!imageSrc}
          />

          <ShapeDimensions
            selectedAnnotation={getSelectedAnnotationObject()}
            onLabelChange={handleLabelChange}
          />

          <AnnotationList
            annotations={annotations}
            selectedAnnotation={selectedAnnotation}
            onSelect={setSelectedAnnotation}
            onDelete={handleDeleteAnnotation}
            onToggleLock={handleToggleLock}
          />
        </aside>
      </div>

      {/* Status Bar + Auto Annotate */}
      <footer className="h-10 border-t border-border bg-card flex items-center justify-between px-4 text-xs text-muted-foreground shrink-0 gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <span>
            Tool: <strong className="text-foreground">{activeTool}</strong>
          </span>
          {isPanning && <span className="text-primary">Panning mode</span>}
          {selectedAnnotation && (
            <span className="text-primary">Shape selected (Delete to remove)</span>
          )}
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <span className="hidden lg:inline">
            Shortcuts: V=Select, P=Marker, B=Box, C=Circle, O=Ellipse, A=Angle, Space=Pan
          </span>
          {imageSrc && (
            <MedicalButton
              variant="primary"
              size="sm"
              onClick={handleAutoAnnotate}
              disabled={isDetecting}
              className="shrink-0"
            >
              {isDetecting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  Auto Annotating...
                </>
              ) : (
                "Auto Annotate"
              )}
            </MedicalButton>
          )}
        </div>
      </footer>
    </div>
  );
};

export default XRayAnnotation;
