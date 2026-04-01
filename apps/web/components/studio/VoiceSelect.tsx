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
  const saved = voiceOptions.filter((v) => v.group === "saved");
  const preset = voiceOptions.filter((v) => v.group === "preset");
  return (
    <select
      className="mt-1 w-full rounded-lg border border-line bg-fill p-2 text-sm focus:border-brand focus:ring-2 focus:ring-brand/20"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {saved.length === 0 ? null : (
        <optgroup label="克隆音色">
          {saved.map((v) => (
            <option key={v.key} value={v.key}>
              {v.label}
            </option>
          ))}
        </optgroup>
      )}
      <optgroup label="预设音色">
        {preset.map((v) => (
          <option key={v.key} value={v.key}>
            {v.label}
          </option>
        ))}
      </optgroup>
    </select>
  );
}
