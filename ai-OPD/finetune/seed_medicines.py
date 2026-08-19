"""Common Indian OPD formulations, used to seed the medicine catalogue and to
generate synthetic training data.

This is a starting vocabulary, not a drug database — the real catalogue is the
one that grows from what the doctor actually prescribes (see
`medicine_catalog` and MedicinesService.recordUsage).
"""

# (name, strength, form, typical indication keyword)
MEDICINES = [
    ("Dolo 650", "650mg", "tablet", "fever"),
    ("Paracetamol", "500mg", "tablet", "fever"),
    ("Crocin Advance", "500mg", "tablet", "fever"),
    ("Azithral 500", "500mg", "tablet", "infection"),
    ("Augmentin 625", "625mg", "tablet", "infection"),
    ("Amoxyclav 625", "625mg", "tablet", "infection"),
    ("Cefixime", "200mg", "tablet", "infection"),
    ("Pantop 40", "40mg", "tablet", "acidity"),
    ("Pan 40", "40mg", "tablet", "acidity"),
    ("Omez", "20mg", "capsule", "acidity"),
    ("Rantac 150", "150mg", "tablet", "acidity"),
    ("Cetirizine", "10mg", "tablet", "allergy"),
    ("Montek LC", "10mg", "tablet", "allergy"),
    ("Allegra 120", "120mg", "tablet", "allergy"),
    ("Ascoril LS", "", "syrup", "cough"),
    ("Grilinctus", "", "syrup", "cough"),
    ("Benadryl", "", "syrup", "cough"),
    ("Combiflam", "", "tablet", "pain"),
    ("Brufen 400", "400mg", "tablet", "pain"),
    ("Zerodol SP", "", "tablet", "pain"),
    ("Meftal Spas", "", "tablet", "pain"),
    ("ORS", "", "sachet", "dehydration"),
    ("Zincovit", "", "tablet", "vitamin"),
    ("Becosules", "", "capsule", "vitamin"),
    ("Shelcal 500", "500mg", "tablet", "vitamin"),
    ("Neurobion Forte", "", "tablet", "vitamin"),
    ("Metformin", "500mg", "tablet", "diabetes"),
    ("Glycomet 500", "500mg", "tablet", "diabetes"),
    ("Telma 40", "40mg", "tablet", "hypertension"),
    ("Amlodipine", "5mg", "tablet", "hypertension"),
    ("Atorva 10", "10mg", "tablet", "cholesterol"),
    ("Thyronorm", "50mcg", "tablet", "thyroid"),
    ("Norflox TZ", "", "tablet", "loose motion"),
    ("Ofloxacin", "200mg", "tablet", "loose motion"),
    ("Domstal", "10mg", "tablet", "vomiting"),
    ("Ondem 4", "4mg", "tablet", "vomiting"),
]

NAMES = [m[0] for m in MEDICINES]
