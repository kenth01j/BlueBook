const router = require('express').Router();
const mongoose = require('mongoose');
const Product = require('../models/Product');
const { requireAuth, requireRole } = require('../middleware/auth');
router.get('/', async (_req, res, next) => {
  try { const products = await Product.find({ active: true }).sort({ name: 1 }); res.json({ products: products.map(p => ({ id: p._id, sku: p.sku, name: p.name, description: p.description, price: p.price, stock: Math.max(0, p.onHand - p.reserved), onHand: p.onHand, reserved: p.reserved, active: p.active })) }); }
  catch (error) { next(error); }
});
router.patch('/:id/stock', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const stock = Number(req.body.stock);
    if (!Number.isInteger(stock) || stock < 0) return res.status(400).json({ message: 'Stock must be a non-negative whole number.' });
    const product = await Product.findOneAndUpdate({ _id: req.params.id, reserved: { $lte: stock } }, { $set: { onHand: stock } }, { new: true, runValidators: true });
    if (!product) return res.status(409).json({ message: 'Product not found or new stock is below already reserved quantity.' });
    res.json({ product: { id: product._id, sku: product.sku, name: product.name, price: product.price, stock: product.onHand - product.reserved, onHand: product.onHand, reserved: product.reserved } });
  } catch (error) { next(error); }
});
router.patch('/:id/price', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid product ID.' });
    }

    const rawPrice = req.body.price;
    const price = rawPrice;
    if (
      typeof price !== 'number' ||
      !Number.isFinite(price) ||
      price < 0 ||
      Math.round(price * 100) / 100 !== price
    ) {
      return res.status(400).json({ message: 'Price must be a non-negative amount with at most two decimal places.' });
    }

    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, active: true },
      { $set: { price } },
      { new: true, runValidators: true }
    );
    if (!product) return res.status(404).json({ message: 'Active product not found.' });

    res.json({
      product: {
        id: product._id,
        sku: product.sku,
        name: product.name,
        price: product.price,
        stock: product.onHand - product.reserved,
        onHand: product.onHand,
        reserved: product.reserved
      }
    });
  } catch (error) { next(error); }
});
module.exports = router;
