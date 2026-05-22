/**
 * Layer B：Lucide 统一 strokeWidth=2，经此文件导出以避免散落直引 lucide-react。
 */
import {
  ArrowLeft as LArrowLeft,
  Check as LCheck,
  ChevronDown as LChevronDown,
  ChevronLeft as LChevronLeft,
  ChevronRight as LChevronRight,
  ChevronUp as LChevronUp,
  CircleHelp as LCircleHelp,
  CircleX as LCircleX,
  Copy as LCopy,
  Download as LDownload,
  FileText as LFileText,
  GripVertical as LGripVertical,
  Headphones as LHeadphones,
  History as LHistory,
  Maximize2 as LMaximize2,
  Minimize2 as LMinimize2,
  Minus as LMinus,
  MoreHorizontal as LMoreHorizontal,
  Music as LMusic,
  Music2 as LMusic2,
  PanelRightClose as LPanelRightClose,
  PanelRightOpen as LPanelRightOpen,
  Pencil as LPencil,
  Plus as LPlus,
  RotateCw as LRotateCw,
  Save as LSave,
  Scissors as LScissors,
  Search as LSearch,
  SlidersHorizontal as LSlidersHorizontal,
  Sparkles as LSparkles,
  Trash2 as LTrash2,
  Undo2 as LUndo2,
  Volume2 as LVolume2,
  type LucideIcon
} from "lucide-react";
import type { LucideProps } from "lucide-react";

const SW = 2;

function wrap(Icon: LucideIcon) {
  return function Wrapped(props: LucideProps) {
    return <Icon strokeWidth={SW} {...props} />;
  };
}

export const ArrowLeft = wrap(LArrowLeft);
export const Check = wrap(LCheck);
export const ChevronDown = wrap(LChevronDown);
export const ChevronLeft = wrap(LChevronLeft);
export const ChevronRight = wrap(LChevronRight);
export const ChevronUp = wrap(LChevronUp);
export const CircleHelp = wrap(LCircleHelp);
export const CircleX = wrap(LCircleX);
export const Copy = wrap(LCopy);
export const Download = wrap(LDownload);
export const FileText = wrap(LFileText);
export const GripVertical = wrap(LGripVertical);
export const Headphones = wrap(LHeadphones);
export const History = wrap(LHistory);
export const Maximize2 = wrap(LMaximize2);
export const Minimize2 = wrap(LMinimize2);
export const Minus = wrap(LMinus);
export const MoreHorizontal = wrap(LMoreHorizontal);
export const Music = wrap(LMusic);
export const Music2 = wrap(LMusic2);
export const PanelRightClose = wrap(LPanelRightClose);
export const PanelRightOpen = wrap(LPanelRightOpen);
export const Pencil = wrap(LPencil);
export const Plus = wrap(LPlus);
export const RotateCw = wrap(LRotateCw);
export const Save = wrap(LSave);
export const Scissors = wrap(LScissors);
export const Search = wrap(LSearch);
export const SlidersHorizontal = wrap(LSlidersHorizontal);
export const Sparkles = wrap(LSparkles);
export const Trash2 = wrap(LTrash2);
export const Undo2 = wrap(LUndo2);
export const Volume2 = wrap(LVolume2);
