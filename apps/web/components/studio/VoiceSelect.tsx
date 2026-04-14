import { useI18n } from "../../lib/I18nContext";

export type VoiceOpt = {
  key: string;
  voice_id: string;
  name: string;
  label: string;
  group: string;
};

export function VoiceSelect({
  value,
  onChange,
  voiceOptions
}: {
  value: string;
  onChange: (v: string) => void;
  voiceOptions: VoiceOpt[];
}) {
  const { t } = useI18n();
  const preset = voiceOptions.filter((v) => v.group === "preset");
  const saved = voiceOptions.filter((v) => v.group === "saved");
  const system = voiceOptions.filter((v) => v.group === "system");
  return (
    <select
      className="mt-1 w-full rounded-lg border border-line bg-fill p-2 text-sm focus:border-brand focus:ring-2 focus:ring-brand/20"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <optgroup label={t("voice.select.groupDefault")}>
        {preset.map((v) => (
          <option key={v.key} value={v.key}>
            {v.label}
          </option>
        ))}
      </optgroup>
      {saved.length === 0 ? null : (
        <optgroup label={t("voice.select.groupClone")}>
          {saved.map((v) => (
            <option key={v.key} value={v.key}>
              {v.label}
            </option>
          ))}
        </optgroup>
      )}
      {system.length === 0 ? null : (
        <optgroup label={t("voice.select.groupSystem")}>
          {system.map((v) => (
            <option key={v.key} value={v.key}>
              {v.label}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}
