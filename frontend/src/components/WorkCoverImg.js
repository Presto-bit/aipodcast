import React, { useState } from 'react';

/**
 * 作品卡片封面：加载失败时回退为占位，避免裂图。
 */
export default function WorkCoverImg({ src, className = 'podcast-work-card-img' }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className={`${className} podcast-work-card-img--placeholder`} aria-hidden>
        FYV
      </div>
    );
  }
  return (
    <img
      className={className}
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}
