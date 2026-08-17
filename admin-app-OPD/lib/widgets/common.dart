import 'package:flutter/material.dart';
import '../theme.dart';

/// A soft-outlined section card matching the Calm Clinical look.
class SectionCard extends StatelessWidget {
  final Widget child;
  final EdgeInsets padding;
  const SectionCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(16),
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: padding,
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(AppRadius.card),
        border: Border.all(color: AppColors.border, width: 0.5),
      ),
      child: child,
    );
  }
}

/// Small bold section heading used inside cards.
class CardTitle extends StatelessWidget {
  final String text;
  const CardTitle(this.text, {super.key});
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: Text(text,
            style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
      );
}

enum _Tone { success, warning, danger, neutral, info }

/// Pill badge mapping a status string to a Calm Clinical colour.
class StatusBadge extends StatelessWidget {
  final String value;
  final String? label;
  const StatusBadge(this.value, {super.key, this.label});

  _Tone get _tone => switch (value) {
        'verified' ||
        'done' ||
        'confirmed' ||
        'available' ||
        'active' ||
        'enabled' =>
          _Tone.success,
        'paid_unverified' || 'pending' || 'on_hold' => _Tone.warning,
        'rejected' || 'inactive' => _Tone.danger,
        'disabled' || 'booked' || 'past' => _Tone.neutral,
        _ => _Tone.info,
      };

  @override
  Widget build(BuildContext context) {
    final (bg, fg) = switch (_tone) {
      _Tone.success => (AppColors.secondaryTint, AppColors.secondary),
      _Tone.warning => (AppColors.onHoldTint, AppColors.onHold),
      _Tone.danger => (AppColors.errorTint, AppColors.error),
      _Tone.neutral => (const Color(0xFFEDEFF2), AppColors.textSecondary),
      _Tone.info => (AppColors.primaryTint, AppColors.primary),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label ?? prettyStatus(value),
        style: TextStyle(color: fg, fontSize: 12, fontWeight: FontWeight.w500),
      ),
    );
  }
}

/// "paid_unverified" -> "Paid unverified".
String prettyStatus(String v) {
  if (v.isEmpty) return v;
  final s = v.replaceAll('_', ' ');
  return s[0].toUpperCase() + s.substring(1);
}

/// Labeled form field wrapper.
class LabeledField extends StatelessWidget {
  final String label;
  final Widget child;
  final String? hint;
  const LabeledField({
    super.key,
    required this.label,
    required this.child,
    this.hint,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label,
              style: const TextStyle(
                  fontSize: 13,
                  color: AppColors.textSecondary,
                  fontWeight: FontWeight.w500)),
          const SizedBox(height: 6),
          child,
          if (hint != null) ...[
            const SizedBox(height: 4),
            Text(hint!,
                style: const TextStyle(
                    fontSize: 12, color: AppColors.textSecondary)),
          ],
        ],
      ),
    );
  }
}

/// Rounded network image with graceful loading + fallback.
class NetworkThumb extends StatelessWidget {
  final String? url;
  final double size;
  final double radius;
  final IconData fallback;
  const NetworkThumb({
    super.key,
    required this.url,
    this.size = 48,
    this.radius = 10,
    this.fallback = Icons.person,
  });

  @override
  Widget build(BuildContext context) {
    final placeholder = Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: AppColors.primaryTint,
        borderRadius: BorderRadius.circular(radius),
      ),
      child: Icon(fallback, color: AppColors.primary, size: size * 0.5),
    );
    if (url == null || url!.isEmpty) return placeholder;
    return ClipRRect(
      borderRadius: BorderRadius.circular(radius),
      child: Image.network(
        url!,
        width: size,
        height: size,
        fit: BoxFit.cover,
        errorBuilder: (_, _, _) => placeholder,
        loadingBuilder: (c, child, progress) =>
            progress == null ? child : placeholder,
      ),
    );
  }
}

/// Loading / error / empty state placeholder.
class StateView extends StatelessWidget {
  final bool loading;
  final String? error;
  final VoidCallback? onRetry;
  final String? empty;
  const StateView({
    super.key,
    this.loading = false,
    this.error,
    this.onRetry,
    this.empty,
  });

  @override
  Widget build(BuildContext context) {
    if (loading) {
      return const Center(child: CircularProgressIndicator(strokeWidth: 2.4));
    }
    if (error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.error_outline, color: AppColors.error, size: 40),
              const SizedBox(height: 12),
              Text(error!,
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: AppColors.textSecondary)),
              if (onRetry != null) ...[
                const SizedBox(height: 16),
                OutlinedButton(onPressed: onRetry, child: const Text('Retry')),
              ],
            ],
          ),
        ),
      );
    }
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Text(empty ?? 'Nothing here yet.',
            textAlign: TextAlign.center,
            style: const TextStyle(color: AppColors.textSecondary)),
      ),
    );
  }
}

void showErrorSnack(BuildContext context, String message) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(
      content: Text(message),
      backgroundColor: AppColors.error,
      behavior: SnackBarBehavior.floating,
    ));
}

void showSuccessSnack(BuildContext context, String message) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(
      content: Text(message),
      backgroundColor: AppColors.secondary,
      behavior: SnackBarBehavior.floating,
    ));
}
