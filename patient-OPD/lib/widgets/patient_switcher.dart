import 'package:flutter/material.dart';
import '../api/models.dart';
import '../auth/patient_scope.dart';
import '../theme.dart';

/// Switches which person on this number the screen is about.
///
/// Hidden when the account has only one patient — that one is auto-selected, so
/// there is nothing to choose.
class PatientSwitcher extends StatelessWidget {
  const PatientSwitcher({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = PatientAuthScope.of(context);
    if (auth.profiles.length < 2) return const SizedBox.shrink();

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      child: Row(
        children: [
          const Icon(Icons.people_outline,
              size: 18, color: AppColors.textSecondary),
          const SizedBox(width: 8),
          const Text('Viewing', style: TextStyle(color: AppColors.textSecondary)),
          const SizedBox(width: 10),
          Expanded(
            child: DropdownButton<String>(
              isExpanded: true,
              value: auth.selectedProfileId,
              underline: const SizedBox.shrink(),
              items: [
                for (final p in auth.profiles)
                  DropdownMenuItem(
                    value: p.id,
                    child: Text('${p.name} · ${p.patientCode}',
                        overflow: TextOverflow.ellipsis),
                  ),
              ],
              onChanged: (v) {
                if (v != null) auth.selectProfile(v);
              },
            ),
          ),
        ],
      ),
    );
  }
}

/// Gate for any screen showing one patient's records.
///
/// There is no default patient by design, so when a number carries several
/// people the screen cannot load anything until one is chosen. This renders the
/// chooser in place of the content, which also guarantees no request is ever
/// made without a `profile_id`.
class RequirePatient extends StatelessWidget {
  final Widget Function(BuildContext context, PatientProfile patient) builder;
  const RequirePatient({super.key, required this.builder});

  @override
  Widget build(BuildContext context) {
    final auth = PatientAuthScope.of(context);
    final selected = auth.selected;
    if (selected != null) return builder(context, selected);

    if (auth.profiles.isEmpty) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(32),
          child: Text(
            'No patients are registered on this number yet. Book an '
            'appointment to add one.',
            textAlign: TextAlign.center,
            style: TextStyle(color: AppColors.textSecondary),
          ),
        ),
      );
    }

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        const Text(
          'Whose records would you like to see?',
          style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 4),
        const Text(
          'This number has more than one patient registered on it.',
          style: TextStyle(color: AppColors.textSecondary),
        ),
        const SizedBox(height: 14),
        for (final p in auth.profiles)
          Card(
            margin: const EdgeInsets.only(bottom: 10),
            child: ListTile(
              title: Text(p.name,
                  style: const TextStyle(fontWeight: FontWeight.w600)),
              subtitle: Text(p.subtitle),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => auth.selectProfile(p.id),
            ),
          ),
      ],
    );
  }
}
