const express = require('express');
const router = express.Router();
const {
  getDietPlans,
  getMyDietPlans,
  getDietPlanById,
  createDietPlan,
  updateDietPlan,
  deleteDietPlan,
} = require('../controllers/diet.controller');
const { protect, trainerOrAdmin } = require('../middlewares/auth.middleware');

router.get('/', getDietPlans);
router.get('/my', protect, getMyDietPlans);
router.get('/:id', getDietPlanById);
router.post('/', protect, trainerOrAdmin, createDietPlan);
router.put('/:id', protect, trainerOrAdmin, updateDietPlan);
router.delete('/:id', protect, trainerOrAdmin, deleteDietPlan);

module.exports = router;
