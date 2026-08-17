import React from 'react';
import { User } from 'lucide-react';

interface NetworkAvatarProps {
  url?: string | null;
  size?: number;
  alt?: string;
}

export const NetworkAvatar: React.FC<NetworkAvatarProps> = ({
  url,
  size = 64,
  alt = 'Doctor Avatar',
}) => {
  const [error, setError] = React.useState(false);

  const borderRadius = `${size / 4}px`;

  if (!url || error) {
    return (
      <div
        className="doctor-avatar"
        style={{
          width: `${size}px`,
          height: `${size}px`,
          borderRadius,
        }}
      >
        <User size={size * 0.45} />
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={alt}
      onError={() => setError(true)}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        borderRadius,
        objectFit: 'cover',
      }}
    />
  );
};
