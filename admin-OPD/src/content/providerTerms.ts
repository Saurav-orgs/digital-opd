/**
 * Healthcare Provider / Registered Medical Practitioner Terms & Conditions.
 *
 * Transcribed verbatim from the Terms and Conditions document supplied by the
 * client — the same file also carries the Patient Terms, which are not used
 * here. Do not paraphrase when updating: a doctor's acceptance is recorded
 * against PROVIDER_TERMS_VERSION, so the wording and the version have to move
 * together for that record to mean anything.
 */

/** Bumped whenever the wording below changes. Stored with each acceptance. */
export const PROVIDER_TERMS_VERSION = '2026-09-01';

export const PROVIDER_TERMS_TITLE = "Healthcare Provider / Registered Medical Practitioner Terms & Conditions";

export const PROVIDER_TERMS_EFFECTIVE = "Effective Date: 1 Sept 2026 · Last Updated: 1 Sept 2026";

export const PROVIDER_TERMS_PREAMBLE: string[] = [
  "These Healthcare Provider Terms & Conditions (\"Provider Terms\") govern the registration and use of the myDigital OPD platform by doctors, Registered Medical Practitioners (\"RMPs\"), clinics, hospitals and other healthcare establishments (\"Provider\", \"you\" or \"your\").",
  "The Platform is operated by [Impulsive Web] (\"myDigital OPD\", \"Company\", \"we\", \"us\" or \"our).",
  "By registering with, accessing or using the Platform, you agree to these Provider Terms.",
];

export interface TermsSection {
  n: number;
  title: string;
  items: string[];
}

export const PROVIDER_TERMS: TermsSection[] = [
  {
    n: 1,
    title: "Nature of myDigital OPD",
    items: [
      "1.1 myDigital OPD is a technology platform intended primarily to facilitate appointment discovery, booking, scheduling, communication and administrative coordination between patients and independent Healthcare Providers.",
      "1.2 Unless expressly agreed otherwise in writing, myDigital OPD does not employ, supervise or control the clinical practice of Providers.",
      "1.3 The Provider remains solely responsible for all healthcare services provided to patients.",
      "1.4 Nothing in these Terms creates an employment, partnership, joint-venture or agency relationship between myDigital OPD and the Provider.",
    ],
  },
  {
    n: 2,
    title: "Eligibility",
    items: [
      "You represent and warrant that:",
      "you are legally entitled to practise the relevant healthcare profession;",
      "you possess all licences, registrations and permissions required by applicable law;",
      "your registration is valid and current;",
      "you are not suspended, prohibited or otherwise disqualified from practising;",
      "all information submitted to myDigital OPD is accurate;",
      "all qualifications disclosed are genuine; and",
      "you will immediately notify myDigital OPD of any change affecting your eligibility.",
    ],
  },
  {
    n: 3,
    title: "Registration and Verification",
    items: [
      "3.1 You must provide complete and accurate professional information, including where applicable:",
      "full legal name;",
      "professional qualifications;",
      "speciality;",
      "registration number;",
      "registration authority;",
      "registration validity/status;",
      "clinic address;",
      "contact details;",
      "consultation fees;",
      "areas of practice; and",
      "other information required by law or reasonably requested by myDigital OPD.",
      "3.2 myDigital OPD may verify information against relevant regulatory/professional registers and other reliable sources.",
      "3.3 You authorise myDigital OPD to undertake reasonable verification of your professional credentials.",
      "3.4 You must promptly inform myDigital OPD if:",
      "your registration expires;",
      "your registration is suspended;",
      "disciplinary proceedings are initiated against you where disclosure is legally required;",
      "your licence is restricted;",
      "your qualification information changes;",
      "your clinic address changes; or",
      "you become legally prohibited from providing services.",
      "3.5 myDigital OPD may suspend or remove your listing where it reasonably believes that professional credentials are inaccurate, expired, unverifiable or legally insufficient.",
    ],
  },
  {
    n: 4,
    title: "Sole Responsibility for Medical Services",
    items: [
      "4.1 You acknowledge and agree that you are solely responsible for every medical consultation, examination, diagnosis, treatment decision, prescription, referral, procedure and other healthcare service provided by you.",
      "4.2 myDigital OPD does not:",
      "diagnose patients; it only provides an AI summary that may not be accurate, so doctor should use the documents uploaded by the patient for diagnosis;",
      "determine treatment;",
      "prescribe medicines;",
      "supervise your clinical judgement;",
      "select treatment protocols;",
      "determine whether a patient requires referral; or",
      "guarantee any clinical outcome.",
      "4.3 You shall exercise independent professional judgement in accordance with applicable law, accepted standards of medical practice and applicable professional regulations.",
    ],
  },
  {
    n: 5,
    title: "Doctor-Patient Relationship",
    items: [
      "5.1 The doctor-patient relationship is established directly between you and the patient when you undertake a consultation.",
      "5.2 myDigital OPD is not a party to the doctor-patient relationship merely because it facilitated the appointment.",
      "5.3 You are solely responsible for maintaining appropriate professional boundaries and patient confidentiality.",
    ],
  },
  {
    n: 6,
    title: "Professional Compliance",
    items: [
      "You shall comply with all applicable laws, rules, regulations, professional standards, ethical requirements and directions issued by competent authorities, including requirements applicable to:",
      "registration;",
      "professional conduct;",
      "medical ethics;",
      "informed consent;",
      "patient confidentiality;",
      "prescriptions;",
      "medical records;",
      "clinical establishment requirements;",
      "advertising;",
      "professional communications;",
      "telemedicine, where applicable;",
      "controlled/restricted medicines;",
      "referrals;",
      "emergency care; and",
      "patient rights.",
    ],
  },
  {
    n: 7,
    title: "Clinical Establishment",
    items: [
      "7.1 Where you provide consultation from a clinic, hospital or other healthcare establishment, you are responsible for ensuring that the establishment complies with applicable registration, licensing, infrastructure, staffing, safety and other legal requirements.",
      "7.2 Where applicable, the Provider shall comply with the Clinical Establishments (Registration and Regulation) Act, 2010 and corresponding State laws/rules.",
      "The Clinical Establishments Act provides for registration and regulation of clinical establishments and includes provisions concerning registration, standards and penalties; its applicability varies by State/UT and must therefore be assessed for each clinic location.",
    ],
  },
  {
    n: 8,
    title: "Appointment Management",
    items: [
      "8.1 You shall maintain accurate appointment availability on the Platform.",
      "8.2 You shall make reasonable efforts to honour confirmed appointments.",
      "8.3 If you cannot attend an appointment, you shall notify the patient and myDigital OPD as soon as reasonably practicable.",
      "8.4 Repeated unexplained cancellations, no-shows or appointment manipulation may result in suspension or termination.",
    ],
  },
  {
    n: 9,
    title: "Medical Examination and Diagnosis",
    items: [
      "9.1 You shall determine, using your professional judgement, whether adequate information and examination are available for diagnosis or treatment.",
      "9.2 You shall not represent that an appointment booking itself constitutes diagnosis or treatment.",
      "9.3 Where a physical examination, investigation, specialist referral or emergency treatment is required, you shall advise the patient appropriately.",
    ],
  },
  {
    n: 10,
    title: "Emergency Situations",
    items: [
      "10.1 You remain responsible for exercising appropriate professional judgement where a patient presents with an emergency.",
      "10.2 You shall not use the Platform's appointment mechanism as a substitute for emergency medical care.",
      "10.3 Where necessary, you shall advise the patient to seek immediate emergency/in-person care or facilitate appropriate referral.",
    ],
  },
  {
    n: 11,
    title: "Prescriptions",
    items: [
      "11.1 You are solely responsible for prescriptions issued by you.",
      "11.2 You shall prescribe medicines in accordance with applicable law and professional standards.",
      "11.3 You shall consider relevant patient information, allergies, contraindications, drug interactions and other clinically relevant factors.",
      "11.4 myDigital OPD does not independently verify the clinical appropriateness of your prescriptions.",
      "11.5 You shall not require myDigital OPD to alter, suppress or modify a clinical prescription.",
    ],
  },
  {
    n: 12,
    title: "Medical Records",
    items: [
      "12.1 You shall maintain appropriate medical records relating to patients in accordance with applicable law and professional requirements.",
      "12.2 Where myDigital OPD provides administrative or record-management functionality, such functionality does not transfer professional responsibility for the accuracy, completeness or clinical adequacy of the medical record to myDigital OPD.",
      "12.3 You remain responsible for ensuring that the patient's clinical record is complete and accurate.",
      "12.4 You shall cooperate with lawful patient requests concerning access to records and with legally valid requests from competent authorities.",
    ],
  },
  {
    n: 13,
    title: "Informed Consent",
    items: [
      "13.1 You are responsible for obtaining informed consent wherever required by law or professional standards.",
      "13.2 myDigital OPD's appointment booking or platform acceptance shall not automatically constitute informed consent for a medical procedure or treatment.",
      "13.3 Where consent is required for a specific examination, procedure, investigation or treatment, you shall obtain the appropriate consent.",
    ],
  },
  {
    n: 14,
    title: "Patient Information",
    items: [
      "14.1 You shall treat patient information confidentially.",
      "14.2 You shall use patient information only for lawful and professionally appropriate purposes.",
      "14.3 You shall not disclose patient information to third parties except:",
      "with appropriate patient consent;",
      "where necessary for legitimate healthcare purposes;",
      "where required by law;",
      "pursuant to lawful governmental/court authority; or",
      "where otherwise permitted by applicable law.",
    ],
  },
  {
    n: 15,
    title: "Data Protection",
    items: [
      "15.1 You shall comply with applicable Indian data-protection and privacy laws when accessing, storing, using or sharing patient information.",
      "15.2 You shall implement reasonable administrative, technical and organisational safeguards appropriate to the patient information in your possession.",
      "15.3 You shall immediately notify myDigital OPD of any suspected unauthorised access, disclosure, loss or compromise of patient information obtained through the Platform.",
      "15.4 You shall not download, copy, sell, market, disclose or commercially exploit patient information obtained through myDigital OPD except where legally permitted and professionally necessary.",
    ],
  },
  {
    n: 16,
    title: "Advertising and Professional Representation",
    items: [
      "16.1 You shall not use the Platform in a manner that violates applicable professional advertising or ethical restrictions.",
      "16.2 You shall not make false, misleading, exaggerated or unverifiable claims concerning:",
      "qualifications;",
      "experience;",
      "speciality;",
      "success rates;",
      "cures;",
      "treatments;",
      "awards;",
      "outcomes; or",
      "superiority over other practitioners.",
      "16.3 You shall not manipulate patient reviews, ratings or appointment data.",
      "16.4 You shall not use the Platform to engage in conduct prohibited by professional regulatory authorities.",
    ],
  },
  {
    n: 17,
    title: "Patient Reviews",
    items: [
      "17.1 Where ratings/reviews are enabled, you acknowledge that patient feedback may be displayed subject to Platform policies and applicable law.",
      "17.2 You shall not:",
      "create fake reviews;",
      "induce patients to submit misleading reviews;",
      "threaten patients over reviews;",
      "offer improper incentives for positive reviews; or",
      "manipulate Platform ratings.",
      "17.3 myDigital OPD may remove content that is unlawful or violates Platform policies, subject to applicable law.",
    ],
  },
  {
    n: 18,
    title: "Taxes",
    items: [
      "18.1 You are solely responsible for determining and complying with your tax obligations arising from professional services provided by you.",
      "18.2 You shall provide invoices, receipts, GST information and other documentation where legally required.",
      "18.3 myDigital OPD may collect, withhold, report or remit amounts, if any where required by applicable law or the commercial arrangement.",
    ],
  },
  {
    n: 19,
    title: "Patient Complaints and Claims",
    items: [
      "19.1 You acknowledge that complaints concerning diagnosis, treatment, prescriptions, medical negligence, professional misconduct or clinical outcomes may be made directly against you.",
      "19.2 You shall cooperate reasonably with myDigital OPD in responding to complaints concerning appointments or Platform functionality.",
      "19.3 You shall cooperate with lawful investigations by competent authorities.",
      "19.4 myDigital OPD shall not be responsible for defending or settling claims arising solely from your independent medical services unless expressly agreed in writing.",
    ],
  },
  {
    n: 20,
    title: "Provider Indemnity",
    items: [
      "To the maximum extent permitted by law, you agree to indemnify and hold harmless myDigital OPD, its directors, officers, employees and service providers from claims, losses, liabilities, costs and expenses arising from or relating to:",
      "your medical consultation;",
      "diagnosis;",
      "treatment;",
      "prescription;",
      "procedure;",
      "medical negligence;",
      "professional misconduct;",
      "breach of patient confidentiality;",
      "violation of medical ethics;",
      "failure to maintain legally required registration;",
      "false qualifications or credentials;",
      "violation of applicable law;",
      "breach of these Provider Terms;",
      "infringement of third-party rights; or",
      "your acts or omissions in providing healthcare services.",
      "This indemnity shall not extend to losses caused by myDigital OPD's own negligence, wilful misconduct or violation of applicable law.",
    ],
  },
  {
    n: 21,
    title: "Professional Liability Insurance",
    items: [
      "21.1 You are responsible for maintaining professional indemnity or malpractice insurance where required by law, applicable professional standards, your contractual arrangements or where otherwise appropriate to your practice.",
      "21.2 Upon reasonable request, you shall provide evidence of such insurance.",
    ],
  },
  {
    n: 22,
    title: "Platform Disclaimer",
    items: [
      "22.1 myDigital OPD does not guarantee:",
      "the accuracy of clinical information supplied by a patient;",
      "the clinical competence of a Provider beyond reasonable verification undertaken by the Platform;",
      "the outcome of a consultation;",
      "the success of treatment;",
      "continued availability of a Provider;",
      "uninterrupted appointment availability; or",
      "absence of professional disputes.",
      "24.2 Platform verification does not constitute a guarantee or warranty of medical competence or clinical outcome.",
    ],
  },
  {
    n: 25,
    title: "Platform Liability",
    items: [
      "To the maximum extent permitted by law, myDigital OPD shall not be liable for claims arising solely from:",
      "your clinical judgement;",
      "your diagnosis;",
      "your treatment;",
      "your prescription;",
      "your failure to diagnose;",
      "your failure to refer;",
      "your failure to follow up;",
      "your professional misconduct;",
      "your breach of patient confidentiality;",
      "your violation of applicable medical law; or",
      "your acts or omissions in treating a patient.",
      "Nothing in these Terms excludes liability that cannot lawfully be excluded.",
    ],
  },
  {
    n: 26,
    title: "Platform Operations",
    items: [
      "myDigital OPD may:",
      "modify Platform functionality;",
      "change appointment-management features;",
      "suspend accounts;",
      "remove listings;",
      "restrict access;",
      "conduct credential verification;",
      "investigate complaints;",
      "introduce or discontinue features; and",
      "take reasonable measures to protect patients, Providers and the Platform.",
    ],
  },
  {
    n: 27,
    title: "Suspension and Termination",
    items: [
      "myDigital OPD may suspend or terminate your access where it reasonably believes that:",
      "your registration is invalid or unverifiable;",
      "you have breached professional requirements;",
      "you have violated these Terms;",
      "you have engaged in fraudulent conduct;",
      "patient safety may be compromised;",
      "you have repeatedly failed to honour appointments;",
      "you have misused patient data;",
      "you have engaged in prohibited advertising;",
      "a competent authority has directed action; or",
      "continued listing presents a material legal, regulatory or safety risk.",
    ],
  },
  {
    n: 28,
    title: "Effect of Termination",
    items: [
      "Termination shall not affect:",
      "accrued payment obligations;",
      "confidentiality obligations;",
      "data-protection obligations;",
      "indemnity obligations;",
      "dispute-resolution provisions; or",
      "liabilities arising before termination.",
    ],
  },
  {
    n: 29,
    title: "Confidentiality",
    items: [
      "You shall keep confidential non-public business, technical and commercial information received from myDigital OPD.",
    ],
  },
  {
    n: 30,
    title: "Intellectual Property",
    items: [
      "All Platform software, trademarks, designs, documentation and proprietary materials remain the property of myDigital OPD or its licensors.",
      "You receive only a limited right to use the Platform for providing lawful healthcare services and managing appointments.",
    ],
  },
  {
    n: 31,
    title: "No Circumvention",
    items: [
      "Where applicable to the commercial arrangement, you shall not knowingly use Platform information to circumvent agreed Platform fees or commercial arrangements by manipulating bookings or falsely representing Platform-originated appointments as direct appointments.",
      "This clause shall not prevent a patient from exercising a lawful choice concerning future healthcare services.",
    ],
  },
  {
    n: 32,
    title: "Compliance with Law",
    items: [
      "You shall comply with all applicable central, State and local laws and professional requirements applicable to your practice.",
      "Nothing in these Provider Terms is intended to authorise conduct that is prohibited by law or professional regulation.",
    ],
  },
  {
    n: 33,
    title: "Changes",
    items: [
      "myDigital OPD may amend these Provider Terms from time to time.",
      "Material amendments shall be communicated in an appropriate manner.",
      "Continued use after the effective date constitutes acceptance to the extent permitted by law.",
    ],
  },
  {
    n: 34,
    title: "Governing Law and Jurisdiction",
    items: [
      "These Provider Terms shall be governed by the laws of India.",
      "Subject to mandatory jurisdiction of statutory and regulatory authorities, courts at Noida, Uttar Pradesh shall have jurisdiction.",
    ],
  },
  {
    n: 35,
    title: "Severability",
    items: [
      "If any provision is held invalid or unenforceable, the remaining provisions shall remain effective to the extent permitted by law.",
    ],
  },
  {
    n: 36,
    title: "Entire Agreement",
    items: [
      "These Provider Terms, the applicable commercial agreement, Privacy Policy, payment/settlement terms and other expressly incorporated policies constitute the agreement between the Provider and myDigital OPD.",
    ],
  },
  {
    n: 37,
    title: "Provider Acknowledgement",
    items: [
      "By registering or continuing to use myDigital OPD, the Provider confirms that:",
      "the information supplied to myDigital OPD is accurate;",
      "the Provider is legally authorised to practise;",
      "the Provider is responsible for all medical services provided;",
      "myDigital OPD is a technology/appointment facilitation platform and not the treating medical practitioner;",
      "the Provider will comply with applicable medical laws and professional standards; and",
      "the Provider has read and accepted these Provider Terms.",
    ],
  },
];
