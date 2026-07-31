import { ClubContactForm } from '../components/ClubContactForm';

export function ClubContact() {
  return (
    <div className="page-container profile-page club-contact-profile-page">
      <ClubContactForm showPersonalFields={false} />
    </div>
  );
}
