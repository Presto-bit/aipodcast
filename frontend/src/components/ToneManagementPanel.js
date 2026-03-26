import React, { useState } from 'react';
import YourVoicePanel from './YourVoicePanel';
import SettingsPanel from './SettingsPanel';
import './ToneManagementPanel.css';

function ToneManagementPanel() {
  const [openYourVoice, setOpenYourVoice] = useState(true);
  const [openVoiceCatalog, setOpenVoiceCatalog] = useState(true);

  return (
    <div className="tone-management-page">
      <details
        open={openYourVoice}
        className="tone-management-card"
        onToggle={(e) => setOpenYourVoice(e.currentTarget.open)}
      >
        <summary className="tone-management-card-summary">你的声音</summary>
        <div className="tone-management-card-body">
          <YourVoicePanel compact />
        </div>
      </details>

      <details
        open={openVoiceCatalog}
        className="tone-management-card"
        onToggle={(e) => setOpenVoiceCatalog(e.currentTarget.open)}
      >
        <summary className="tone-management-card-summary">音色管理</summary>
        <div className="tone-management-card-body">
          <SettingsPanel variant="catalog" embedded />
        </div>
      </details>
    </div>
  );
}

export default ToneManagementPanel;

