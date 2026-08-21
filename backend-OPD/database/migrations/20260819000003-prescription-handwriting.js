'use strict';

/**
 * Handwritten prescriptions.
 *
 * A doctor can now write the prescription by hand on a tablet with a stylus.
 * The strokes are exported as a transparent image and composited onto the
 * doctor's letterhead when the prescription is issued.
 *
 * Table touched:
 *   e_prescriptions — add `mode` (structured | handwritten) and
 *                     `handwriting_image_key` (S3 key of the strokes image).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { STRING } = Sequelize;
    await queryInterface.addColumn('e_prescriptions', 'mode', {
      type: STRING,
      allowNull: false,
      defaultValue: 'structured',
    });
    await queryInterface.addColumn('e_prescriptions', 'handwriting_image_key', {
      type: STRING,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('e_prescriptions', 'handwriting_image_key');
    await queryInterface.removeColumn('e_prescriptions', 'mode');
  },
};
