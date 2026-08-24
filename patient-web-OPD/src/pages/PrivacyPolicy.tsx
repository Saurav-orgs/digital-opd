import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, Lock, FileText, Eye, UserCheck, Server, HelpCircle, ArrowLeft, CheckCircle2 } from 'lucide-react';

export const PrivacyPolicy: React.FC = () => {
  const navigate = useNavigate();

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/');
    }
  };

  return (
    <div className="privacy-page-container">
      {/* Back button */}
      <div className="privacy-top-bar">
        <button
          type="button"
          className="btn-outlined"
          onClick={handleBack}
          style={{ borderRadius: '999px', padding: '8px 20px', cursor: 'pointer' }}
        >
          <ArrowLeft size={16} />
          <span>Back</span>
        </button>
      </div>

      {/* Hero Header */}
      <div className="privacy-hero">
        <div className="privacy-badge">
          <ShieldCheck size={16} />
          <span>Patient Privacy & Confidentiality Guarantee</span>
        </div>
        <h1>Privacy Policy</h1>
        <p className="privacy-subtitle">
          Your health records, personal details, and consultation data are handled with the highest level of privacy, encryption, and medical confidentiality.
        </p>
        <div className="privacy-meta">
          <span>Last Updated: July 2026</span>
          <span>•</span>
          <span>Effective Date: Immediate</span>
        </div>
      </div>

      {/* Main Content Cards */}
      <div className="privacy-content-grid">
        {/* Card 1: Introduction */}
        <section className="privacy-card">
          <div className="privacy-card-header">
            <div className="icon-wrapper icon-blue">
              <Lock size={20} />
            </div>
            <h2>1. Our Privacy Commitment</h2>
          </div>
          <div className="privacy-card-body">
            <p>
              At Digital OPD, we prioritize the protection and security of your personal data and health information. This Privacy Policy details how we collect, process, store, and safeguard your information when you browse doctors, schedule outpatient department (OPD) appointments, or interact with our services.
            </p>
            <div className="privacy-highlight-box">
              <CheckCircle2 size={18} color="#0F6E56" />
              <span>We never sell, trade, or rent your personal health data to third-party advertisers or marketers.</span>
            </div>
          </div>
        </section>

        {/* Card 2: Information We Collect */}
        <section className="privacy-card">
          <div className="privacy-card-header">
            <div className="icon-wrapper icon-teal">
              <FileText size={20} />
            </div>
            <h2>2. Information We Collect</h2>
          </div>
          <div className="privacy-card-body">
            <p>To provide seamless appointment scheduling and OPD consultation management, we collect:</p>
            <ul className="privacy-list">
              <li>
                <strong>Personal Identification Information:</strong> Patient name, mobile number, gender, age, and residential address.
              </li>
              <li>
                <strong>OPD Appointment Details:</strong> Requested date and time slot, and symptoms or reason for visit provided during booking.
              </li>
              <li>
                <strong>Medical Reports:</strong> Report files you choose to upload against a visit so the doctor can review them. Payment for consultations is collected in person at the clinic and is not processed or stored by this platform.
              </li>
              <li>
                <strong>Technical & Usage Information:</strong> Browser type, IP address, device operating system, and session metrics required to ensure platform stability and security.
              </li>
            </ul>
          </div>
        </section>

        {/* Card 3: How We Use Your Data */}
        <section className="privacy-card">
          <div className="privacy-card-header">
            <div className="icon-wrapper icon-amber">
              <Eye size={20} />
            </div>
            <h2>3. How We Use Your Information</h2>
          </div>
          <div className="privacy-card-body">
            <p>Your information is strictly used for clinical and administrative OPD operations:</p>
            <ul className="privacy-list">
              <li>Booking and confirming your appointment with the clinic's OPD desk.</li>
              <li>Sending SMS, email, or WhatsApp booking confirmations, status updates, and appointment reminders.</li>
              <li>Verifying payment receipts and issuing official OPD consultation tokens.</li>
              <li>Enabling the attending doctor to review your consultation history before the visit.</li>
              <li>Improving platform performance, preventing fraud, and resolving patient support requests.</li>
            </ul>
          </div>
        </section>

        {/* Card 4: Security & Encryption */}
        <section className="privacy-card">
          <div className="privacy-card-header">
            <div className="icon-wrapper icon-blue">
              <Server size={20} />
            </div>
            <h2>4. Data Security & Storage</h2>
          </div>
          <div className="privacy-card-body">
            <p>
              We implement industry-standard administrative, physical, and technical security measures to protect your medical data against unauthorized access, loss, or alteration:
            </p>
            <div className="privacy-security-grid">
              <div className="sec-item">
                <div className="sec-title">SSL/TLS Encryption</div>
                <div className="sec-desc">All data transferred between your browser and our servers is encrypted using 256-bit SSL protocols.</div>
              </div>
              <div className="sec-item">
                <div className="sec-title">Role-Based Access</div>
                <div className="sec-desc">Only verified doctors and authorized OPD desk administrators have permission to view patient records.</div>
              </div>
              <div className="sec-item">
                <div className="sec-title">Secure Databases</div>
                <div className="sec-desc">Health data is stored in isolated, encrypted cloud databases protected with regular security audits.</div>
              </div>
            </div>
          </div>
        </section>

        {/* Card 5: Information Sharing */}
        <section className="privacy-card">
          <div className="privacy-card-header">
            <div className="icon-wrapper icon-teal">
              <UserCheck size={20} />
            </div>
            <h2>5. Information Sharing & Disclosure</h2>
          </div>
          <div className="privacy-card-body">
            <p>We restrict data access to essential operational needs only:</p>
            <ul className="privacy-list">
              <li>
                <strong>Attending Healthcare Providers:</strong> Your doctor and clinic staff receive your appointment details to conduct your consultation.
              </li>
              <li>
                <strong>Legal Requirements:</strong> We may disclose data only if explicitly required by applicable medical regulations, court orders, or law enforcement.
              </li>
            </ul>
          </div>
        </section>

        {/* Card 6: Patient Rights & Contact */}
        <section className="privacy-card">
          <div className="privacy-card-header">
            <div className="icon-wrapper icon-amber">
              <HelpCircle size={20} />
            </div>
            <h2>6. Patient Rights & Support</h2>
          </div>
          <div className="privacy-card-body">
            <p>As a patient, you hold rights over your personal information:</p>
            <ul className="privacy-list">
              <li>Request a copy of your appointment history and stored personal records.</li>
              <li>Request corrections to any inaccurate contact information.</li>
              <li>Opt-out of non-essential promotional notifications at any time.</li>
            </ul>
            <div className="privacy-contact-box">
              <h3>Have Privacy Concerns?</h3>
              <p>For privacy queries, data requests, or compliance inquiries, reach out to our dedicated Patient Data Desk:</p>
              <div className="privacy-contact-details">
                {/* TODO: replace with Ittitude's real privacy contact address. */}
                <span>📧 Email: <strong>privacy@opdpatient.com</strong></span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
