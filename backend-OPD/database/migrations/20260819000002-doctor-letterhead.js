'use strict';

/**
 * Per-doctor prescription letterhead.
 *
 * The prescription PDF used to take its letterhead from global env config
 * (CLINIC_NAME, …), which is wrong in a multi-tenant system where every doctor
 * has their own clinic identity. These columns let each doctor set the name,
 * logo, address, and phone that appear at the top of their prescription pad.
 * All nullable — when unset, the PDF falls back to the env clinic, then to the
 * doctor's own name.
 *
 * Table touched:
 *   doctors — add clinic_name, clinic_logo_key, clinic_address, clinic_phone.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { STRING, TEXT } = Sequelize;
    await queryInterface.addColumn('doctors', 'clinic_name', {
      type: STRING,
      allowNull: true,
    });
    await queryInterface.addColumn('doctors', 'clinic_logo_key', {
      type: STRING,
      allowNull: true,
    });
    await queryInterface.addColumn('doctors', 'clinic_address', {
      type: TEXT,
      allowNull: true,
    });
    await queryInterface.addColumn('doctors', 'clinic_phone', {
      type: STRING,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('doctors', 'clinic_phone');
    await queryInterface.removeColumn('doctors', 'clinic_address');
    await queryInterface.removeColumn('doctors', 'clinic_logo_key');
    await queryInterface.removeColumn('doctors', 'clinic_name');
  },
};
