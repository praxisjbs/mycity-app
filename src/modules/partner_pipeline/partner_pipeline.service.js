"use strict";
/**
 * Partnerships · Categories, one door for the controller (docs/guides/partnerships.md §6.3): categories,
 * their agreement templates and delivery checklists, custom fields, MyCity's lists and Start From
 * Tracker. Each lives in its own file beside this one; deals arrive with M7 PR 3.
 */
const categories = require("./partner_pipeline.categories");
const checklists = require("./partner_pipeline.checklists");
const fields = require("./partner_pipeline.fields");
const lists = require("./partner_pipeline.lists");
const setup = require("./partner_pipeline.setup");

module.exports = {
  listCategories: categories.list,
  getCategory: categories.get,
  createCategory: categories.create,
  updateCategory: categories.update,
  getTemplate: categories.getTemplate,
  addTemplate: categories.addTemplate,
  updateTemplate: categories.updateTemplate,
  saveTemplateWording: categories.saveTemplateWording,
  addChecklistItem: checklists.addItem,
  updateChecklistItem: checklists.updateItem,
  listFields: fields.list,
  createField: fields.create,
  updateField: fields.update,
  checkFieldValue: fields.checkValue,
  getList: lists.values,
  addListValue: lists.add,
  updateListValue: lists.update,
  readTracker: setup.read,
  applyTracker: setup.apply,
};
