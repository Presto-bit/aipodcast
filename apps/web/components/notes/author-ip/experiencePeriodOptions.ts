/** 经历时间段选项（工作 / 教育） */

export const WORK_PERIOD_OPTIONS = [
  { value: "", label: "请选择时间段" },
  { value: "至今", label: "至今" },
  { value: "2025 – 至今", label: "2025 – 至今" },
  { value: "2024 – 至今", label: "2024 – 至今" },
  { value: "2023 – 至今", label: "2023 – 至今" },
  { value: "2022 – 2024", label: "2022 – 2024" },
  { value: "2020 – 2023", label: "2020 – 2023" },
  { value: "2018 – 2020", label: "2018 – 2020" },
  { value: "2015 – 2018", label: "2015 – 2018" },
  { value: "2010 – 2015", label: "2010 – 2015" },
  { value: "2005 – 2010", label: "2005 – 2010" }
] as const;

export const EDU_PERIOD_OPTIONS = [
  { value: "", label: "请选择时间段" },
  { value: "2022 – 2025", label: "2022 – 2025" },
  { value: "2018 – 2022", label: "2018 – 2022" },
  { value: "2014 – 2018", label: "2014 – 2018" },
  { value: "2010 – 2014", label: "2010 – 2014" },
  { value: "2006 – 2010", label: "2006 – 2010" },
  { value: "2000 – 2006", label: "2000 – 2006" }
] as const;

export function periodSelectClassName() {
  return "mt-1 w-full rounded-dawn-md border border-line bg-canvas px-2.5 py-1.5 text-sm";
}
