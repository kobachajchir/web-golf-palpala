import type { ReactNode } from 'react';

export function PersonProfileHeader({
  eyebrow,
  title,
  subtitle,
  avatarLabel,
  badges,
  actions,
}: {
  eyebrow: string;
  title: string;
  subtitle: ReactNode;
  avatarLabel: string;
  badges?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="person-profile-header">
      <div className="person-profile-header__avatar" aria-hidden="true">
        {avatarLabel.slice(0, 1).toUpperCase()}
      </div>
      <div className="person-profile-header__copy">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <div className="person-profile-header__subtitle">{subtitle}</div>
        {badges && <div className="person-profile-header__badges">{badges}</div>}
      </div>
      {actions && <div className="person-profile-header__actions">{actions}</div>}
    </div>
  );
}
