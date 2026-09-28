'use strict';

/**
 * The shape of a doctor's uploaded prescription header.
 *
 * The header used to be drawn into a fixed 90pt-tall box, which shrank a
 * dense pad top (clinic timings, several phone numbers) to an unreadable
 * strip. The box's height now follows the image: the PDF needs the image's
 * width-to-height ratio to size it, and the print copy — which draws no
 * header but must leave the same gap — needs it without fetching the image.
 *
 * Measured on the server at upload time. Null for headers uploaded before
 * this change; those keep printing in the old fixed box until re-uploaded.
 *
 * Table touched:
 *   doctors — add letterhead_header_ratio (width / height of the image).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('doctors', 'letterhead_header_ratio', {
      type: Sequelize.FLOAT,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('doctors', 'letterhead_header_ratio');
  },
};
