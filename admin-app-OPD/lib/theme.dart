import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Calm Clinical design system (plan §15) — shared with the admin web + patient app.
/// Flat surfaces, hairline borders, 12px card / 8px control radius, Inter.
class AppColors {
  static const primary = Color(0xFF185FA5);
  static const primaryHover = Color(0xFF0C447C);
  static const primaryTint = Color(0xFFE6F1FB);
  static const secondary = Color(0xFF0F6E56);
  static const secondaryAccent = Color(0xFF1D9E75);
  static const secondaryTint = Color(0xFFE1F5EE);

  static const page = Color(0xFFF7F8FA);
  static const card = Color(0xFFFFFFFF);
  static const border = Color(0xFFE4E7EC);
  static const text = Color(0xFF1A2433);
  static const textSecondary = Color(0xFF5F6B7A);

  // Semantic status colours (map 1:1 to slot state / status badges)
  static const available = Color(0xFF185FA5);
  static const booked = Color(0xFFD3D1C7);
  static const onHold = Color(0xFFBA7517);
  static const onHoldTint = Color(0xFFFBF0DD);
  static const error = Color(0xFFE24B4A);
  static const errorTint = Color(0xFFFBE7E7);
  static const done = Color(0xFF0F6E56);
}

class AppRadius {
  static const card = 12.0;
  static const control = 8.0;
}

ThemeData buildTheme() {
  final base = ThemeData.light(useMaterial3: true);
  final textTheme = GoogleFonts.interTextTheme(base.textTheme).apply(
    bodyColor: AppColors.text,
    displayColor: AppColors.text,
  );

  return base.copyWith(
    scaffoldBackgroundColor: AppColors.page,
    textTheme: textTheme,
    colorScheme: base.colorScheme.copyWith(
      primary: AppColors.primary,
      secondary: AppColors.secondary,
      surface: AppColors.card,
      error: AppColors.error,
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: AppColors.card,
      foregroundColor: AppColors.text,
      elevation: 0,
      scrolledUnderElevation: 0.5,
      centerTitle: false,
    ),
    cardTheme: CardThemeData(
      color: AppColors.card,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppRadius.card),
        side: const BorderSide(color: AppColors.border, width: 0.5),
      ),
      margin: EdgeInsets.zero,
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: AppColors.primary,
        foregroundColor: Colors.white,
        elevation: 0,
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
        textStyle: GoogleFonts.inter(fontWeight: FontWeight.w500, fontSize: 15),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadius.control),
        ),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: AppColors.primary,
        side: const BorderSide(color: AppColors.border, width: 0.8),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        textStyle: GoogleFonts.inter(fontWeight: FontWeight.w500, fontSize: 14),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadius.control),
        ),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: AppColors.card,
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadius.control),
        borderSide: const BorderSide(color: AppColors.border, width: 0.5),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadius.control),
        borderSide: const BorderSide(color: AppColors.border, width: 0.5),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadius.control),
        borderSide: const BorderSide(color: AppColors.primary, width: 1.2),
      ),
      labelStyle: const TextStyle(color: AppColors.textSecondary),
    ),
    dividerColor: AppColors.border,
  );
}
