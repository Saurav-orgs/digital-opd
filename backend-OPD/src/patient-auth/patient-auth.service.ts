import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/sequelize';
import { Patient } from '../database/models/patient.model';
import { Appointment } from '../database/models/appointment.model';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PatientLoginDto } from './dto/patient-login.dto';
import { PatientRegisterDto } from './dto/patient-register.dto';
import { AuthPatient } from './current-patient.decorator';

@Injectable()
export class PatientAuthService {
  constructor(
    @InjectModel(Patient) private readonly patientModel: typeof Patient,
    @InjectModel(Appointment) private readonly appointmentModel: typeof Appointment,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: PatientRegisterDto) {
    const existing = await this.patientModel.findOne({
      where: { mobile: dto.mobile },
    });
    if (existing) {
      throw new AppException(ErrorCode.PATIENT_EXISTS);
    }
    const patient = await this.patientModel.create({
      mobile: dto.mobile,
      name: dto.name.trim(),
    } as any);
    return this.issueSession(patient);
  }

  /**
   * Phone-only login, no OTP: an existing patient logs in directly; a first-
   * time patient who already has a booking under this mobile is silently
   * provisioned (name taken from their most recent booking); otherwise the
   * caller is told to register.
   */
  async login(dto: PatientLoginDto) {
    let patient = await this.patientModel.findOne({
      where: { mobile: dto.mobile },
    });

    if (!patient) {
      const lastBooking = await this.appointmentModel.findOne({
        where: { patient_mobile: dto.mobile },
        order: [['created_at', 'DESC']],
      });
      if (!lastBooking) {
        throw new AppException(ErrorCode.PATIENT_NOT_FOUND);
      }
      patient = await this.patientModel.create({
        mobile: dto.mobile,
        name: lastBooking.patient_name,
      } as any);
    }

    return this.issueSession(patient);
  }

  me(patient: AuthPatient): AuthPatient {
    return patient;
  }

  private async issueSession(patient: Patient) {
    const accessToken = await this.jwtService.signAsync({
      sub: patient.id,
      mobile: patient.mobile,
      kind: 'patient',
    });
    return {
      accessToken,
      patient: { id: patient.id, mobile: patient.mobile, name: patient.name },
    };
  }
}
