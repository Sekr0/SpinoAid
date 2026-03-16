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

const computeDerivedAnnotations = (baseAnnotations: Annotation[]): Annotation[] => {
  const derived: Annotation[] = [];

  // 1. Identify Femoral Heads
  const femoralAnnotations = baseAnnotations.filter((a) => a.label && a.label.startsWith("Femoral head"));
  // 2. Identify S1 Endplate
  const s1Annotation = baseAnnotations.find((a) => a.label && a.label.includes("S1"));

  if (femoralAnnotations.length === 2 && s1Annotation && s1Annotation.points.length >= 2) {
    const f1 = femoralAnnotations[0].points;
    const cx1 = (f1[0].x + f1[1].x) / 2;
    const cy1 = (f1[0].y + f1[1].y) / 2;
    const f2 = femoralAnnotations[1].points;
    const cx2 = (f2[0].x + f2[1].x) / 2;
    const cy2 = (f2[0].y + f2[1].y) / 2;

    const fMid = { x: (cx1 + cx2) / 2, y: (cy1 + cy2) / 2 };

    const s1p1 = s1Annotation.points[0];
    const s1p2 = s1Annotation.points[1];
    const s1Mid = { x: (s1p1.x + s1p2.x) / 2, y: (s1p1.y + s1p2.y) / 2 };

    const s1Vector = { x: s1p2.x - s1p1.x, y: s1p2.y - s1p1.y };
    let sPerpX = -s1Vector.y;
    let sPerpY = s1Vector.x;
    if (sPerpY < 0) {
      sPerpX = s1Vector.y;
      sPerpY = -s1Vector.x;
    }
    const sPerpLen = Math.hypot(sPerpX, sPerpY) || 1;
    const sPerpScale = 300 / sPerpLen; // Much longer, 300px visible line
    const s1PerpEnd = { x: s1Mid.x + sPerpX * sPerpScale, y: s1Mid.y + sPerpY * sPerpScale };

    // PT requires a vertical line from the femoral midpoint.
    const fVerticalEnd = { x: fMid.x, y: fMid.y - 300 }; // 300px long UP

    // PI (Pelvic Incidence) at S1
    derived.push({
      id: `derived_angle_pi`,
      type: "angle",
      points: [s1PerpEnd, s1Mid, fMid],
      color: "#06b6d4",
      label: "PI",
      locked: true,
    });

    // PT (Pelvic Tilt) at Femoral Heads
    derived.push({
      id: `derived_angle_pt`,
      type: "angle",
      points: [fVerticalEnd, fMid, s1Mid],
      color: "#06b6d4",
      label: "PT",
      locked: true,
    });
    
    // SS (Sacral Slope) Angle
    // Take the lower x,y point of S1 endplate, draw a horizontal line, angle between horizontal and S1 endplate
    const s1LowerY = s1p1.y > s1p2.y ? s1p1 : s1p2;
    const s1HigherY = s1p1.y > s1p2.y ? s1p2 : s1p1;
    const horizontalEnd = { x: s1LowerY.x + 150, y: s1LowerY.y };

    derived.push({
      id: `derived_angle_ss`,
      type: "angle",
      points: [s1HigherY, s1LowerY, horizontalEnd],
      color: "#a855f7",
      label: "SS",
      locked: true,
      hideFirstLine: true,
    });

    const piTextPos = { x: s1Mid.x + 80, y: s1Mid.y - 80 };
    derived.push({
      id: `derived_text_pi`,
      type: "text",
      points: [piTextPos, { x: piTextPos.x + 80, y: piTextPos.y + 40 }],
      color: "#06b6d4",
      label: "PI Text",
      text: "PI",
      locked: true,
    });

    const ptTextPos = { x: fMid.x + 80, y: fMid.y - 80 };
    derived.push({
      id: `derived_text_pt`,
      type: "text",
      points: [ptTextPos, { x: ptTextPos.x + 80, y: ptTextPos.y + 40 }],
      color: "#06b6d4",
      label: "PT Text",
      text: "PT",
      locked: true,
    });

    const ssTextPos = { x: s1LowerY.x + 40, y: s1LowerY.y - 40 };
    derived.push({
      id: `derived_text_ss`,
      type: "text",
      points: [ssTextPos, { x: ssTextPos.x + 80, y: ssTextPos.y + 40 }],
      color: "#a855f7",
      label: "SS Text",
      text: "SS",
      locked: true,
    });
  }

  // 3. Identify L1 Superior Endplate for Lumbar Lordosis (LL)
  const l1Annotation = baseAnnotations.find((a) => a.label === "L1" || a.label === "L1 - Superior");
  if (s1Annotation && s1Annotation.points.length >= 2 && l1Annotation && l1Annotation.points.length >= 2) {
    const s1p1 = s1Annotation.points[0];
    const s1p2 = s1Annotation.points[1];
    
    const l1p1 = l1Annotation.points[0];
    const l1p2 = l1Annotation.points[1];

    // Ensure points are ordered left to right for consistency in "extending to the right"
    const s1L = s1p1.x < s1p2.x ? s1p1 : s1p2;
    const s1R = s1p1.x < s1p2.x ? s1p2 : s1p1;
    
    const l1L = l1p1.x < l1p2.x ? l1p1 : l1p2;
    const l1R = l1p1.x < l1p2.x ? l1p2 : l1p1;

    // Vectors representing the endplates
    const vS1 = { x: s1R.x - s1L.x, y: s1R.y - s1L.y };
    const vL1 = { x: l1R.x - l1L.x, y: l1R.y - l1L.y };

    const lenS1 = Math.hypot(vS1.x, vS1.y) || 1;
    const lenL1 = Math.hypot(vL1.x, vL1.y) || 1;

    // Extend lines to the right
    const EXTENSION = 200;
    
    const extS1 = { 
      x: s1R.x + (vS1.x / lenS1) * EXTENSION, 
      y: s1R.y + (vS1.y / lenS1) * EXTENSION 
    };

    const extL1 = { 
      x: l1R.x + (vL1.x / lenL1) * EXTENSION, 
      y: l1R.y + (vL1.y / lenL1) * EXTENSION 
    };

    // Draw dotted extension lines (dashed rendering added in ImageCanvas)
    derived.push({
      id: `derived_line_s1_ext`,
      type: "line",
      points: [s1R, extS1],
      color: "#10b981", // Emerald
      label: "S1 Ext",
      locked: true,
      hidden: false,
      isDashed: true
    });
    derived.push({
      id: `derived_line_l1_ext`,
      type: "line",
      points: [l1R, extL1],
      color: "#10b981",
      label: "L1 Ext",
      locked: true,
      hidden: false,
      isDashed: true
    });

    // Drop perpendiculars
    // S1 perpendicular (going UP -> dy < 0)
    // V = (vS1.y, -vS1.x)
    const pS1dx = vS1.y / lenS1;
    const pS1dy = -vS1.x / lenS1; 
    
    // L1 perpendicular (going DOWN -> dy > 0)
    // V = (-vL1.y, vL1.x)
    const pL1dx = -vL1.y / lenL1;
    const pL1dy = vL1.x / lenL1;

    const ptS1Start = { x: extS1.x, y: extS1.y };
    const ptL1Start = { x: extL1.x, y: extL1.y };

    // Line intersection math:
    // P1 + t1 * V1 = P2 + t2 * V2
    const dx = ptL1Start.x - ptS1Start.x;
    const dy = ptL1Start.y - ptS1Start.y;
    
    const det = -pS1dx * pL1dy + pS1dy * pL1dx;

    if (Math.abs(det) > 0.0001) {
      const t1 = (-dx * pL1dy + dy * pL1dx) / det;
      
      const intersectPoint = {
        x: ptS1Start.x + t1 * pS1dx,
        y: ptS1Start.y + t1 * pS1dy
      };

      // Ensure we draw the acute angle instead of the obtuse one
      let ptL1Angle = ptL1Start;
      const ptS1Angle = ptS1Start;

      const vA = { x: ptL1Angle.x - intersectPoint.x, y: ptL1Angle.y - intersectPoint.y };
      const vB = { x: ptS1Angle.x - intersectPoint.x, y: ptS1Angle.y - intersectPoint.y };

      // If dot product is negative, angle is > 90 (obtuse)
      if (vA.x * vB.x + vA.y * vB.y < 0) {
        // Flip the L1 arm across the intersection to capture the acute angle
        ptL1Angle = {
          x: intersectPoint.x - vA.x,
          y: intersectPoint.y - vA.y
        };
      }

      derived.push({
        id: `derived_angle_ll`,
        type: "angle",
        points: [ptL1Angle, intersectPoint, ptS1Angle],
        color: "#10b981",
        label: "LL",
        locked: true,
        isDashed: true // Renders the arms of the angle dashed
      });

      const llTextPos = { x: intersectPoint.x + 80, y: intersectPoint.y };
      derived.push({
        id: `derived_text_ll`,
        type: "text",
        points: [llTextPos, { x: llTextPos.x + 80, y: llTextPos.y + 40 }],
        color: "#10b981",
        label: "LL Text",
        text: "LL",
        locked: true,
      });
    }
  }


  return derived;
};

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
  const [showAngles, setShowAngles] = useState(true);

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
      const baseAnnotations = newAnnotations.filter(a => !a.id.startsWith("derived_"));
      const derivedAnnotations = computeDerivedAnnotations(baseAnnotations);
      const finalAnnotations = [...baseAnnotations, ...derivedAnnotations];

      setAnnotations(finalAnnotations);
      if (!skipHistory) {
        const newHistory = history.slice(0, historyIndex + 1);
        newHistory.push(finalAnnotations);
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

  const handleToggleVisibility = useCallback((id: string) => {
    setAnnotations((prev) => {
      const updated = prev.map((ann) => ann.id === id ? { ...ann, hidden: !ann.hidden } : ann);
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
      const apiWidth = endplatesResult.image_shape?.width || (endplatesResult as any).image_width;
      const apiHeight = endplatesResult.image_shape?.height || (endplatesResult as any).image_height;
      const scaleX = apiWidth ? imgW / apiWidth : 1;
      const scaleY = apiHeight ? imgH / apiHeight : 1;

      const rawEndplates = (endplatesResult.endplates || []).filter((ep: { detected?: boolean }) => ep.detected !== false);
      
      const s1Endplates = rawEndplates.filter((ep: any) => ep.label === "S1");
      const otherEndplates = rawEndplates.filter((ep: any) => ep.label !== "S1");

      otherEndplates.forEach((ep: any, idx: number) => {
        const x1 = ep.x1 * scaleX;
        const y1 = ep.y1 * scaleY;
        const x2 = ep.x2 * scaleX;
        const y2 = ep.y2 * scaleY;
        const labelText = ep.endplate ? `${ep.label} - ${ep.endplate}` : ep.label;
        newAnnotations.push({
          id: `auto_endplate_${ts}_${idx}`,
          type: "line",
          points: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
          color: "#f59e0b",
          label: labelText,
        });
      });

      if (s1Endplates.length > 0) {
        let sumX1 = 0, sumY1 = 0, sumX2 = 0, sumY2 = 0;
        s1Endplates.forEach((ep: any) => {
          sumX1 += ep.x1;
          sumY1 += ep.y1;
          sumX2 += ep.x2;
          sumY2 += ep.y2;
        });
        const c = s1Endplates.length;
        newAnnotations.push({
          id: `auto_endplate_${ts}_s1_merged`,
          type: "line",
          points: [
            { x: (sumX1 / c) * scaleX, y: (sumY1 / c) * scaleY },
            { x: (sumX2 / c) * scaleX, y: (sumY2 / c) * scaleY }
          ],
          color: "#f59e0b",
          label: "S1",
        });
      }

      if (newAnnotations.length > 0) {
        // We do not compute PT/PI/LL/SS here anymore. 
        // handleAnnotationsChange will automatically apply computeDerivedAnnotations.
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
          <button
            onClick={() => setShowAngles(!showAngles)}
            className="p-2 ml-2 rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors focus-ring"
            aria-label="Toggle Angles"
            title={showAngles ? "Hide Angles" : "Show Angles"}
          >
            {showAngles ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>
            )}
          </button>
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
            className="p-2 ml-1 rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors focus-ring"
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
          showAngles={showAngles}
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
            onToggleVisibility={handleToggleVisibility}
            showAngles={showAngles}
            onToggleShowAngles={() => setShowAngles(!showAngles)}
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
