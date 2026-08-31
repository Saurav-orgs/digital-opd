import { AppSetting } from './app-setting.model';
import { Role } from './role.model';
import { Permission } from './permission.model';
import { RolePermission } from './role-permission.model';
import { User } from './user.model';
import { Doctor } from './doctor.model';
import { OpdSchedule } from './opd-schedule.model';
import { ScheduleException } from './schedule-exception.model';
import { Appointment } from './appointment.model';
import { AppointmentPrescription } from './prescription.model';
import { Patient } from './patient.model';
import { BlockedNumber } from './blocked-number.model';
import { PatientProfile } from './patient-profile.model';
import { PatientReport } from './patient-report.model';
import { Notification } from './notification.model';
import { ConsultationSession } from './consultation-session.model';
import { EPrescription } from './e-prescription.model';
import { EPrescriptionMedicine } from './e-prescription-medicine.model';
import { MedicineCatalog } from './medicine-catalog.model';
import { AiTrainingSample } from './ai-training-sample.model';

export const models = [
  Role,
  Permission,
  RolePermission,
  User,
  Doctor,
  OpdSchedule,
  ScheduleException,
  Appointment,
  AppointmentPrescription,
  BlockedNumber,
  Patient,
  PatientProfile,
  PatientReport,
  Notification,
  ConsultationSession,
  EPrescription,
  EPrescriptionMedicine,
  MedicineCatalog,
  AiTrainingSample,
  AppSetting,
];

export {
  AppSetting,
  Role,
  Permission,
  RolePermission,
  User,
  Doctor,
  OpdSchedule,
  ScheduleException,
  Appointment,
  AppointmentPrescription,
  BlockedNumber,
  Patient,
  PatientProfile,
  PatientReport,
  Notification,
  ConsultationSession,
  EPrescription,
  EPrescriptionMedicine,
  MedicineCatalog,
  AiTrainingSample,
};
