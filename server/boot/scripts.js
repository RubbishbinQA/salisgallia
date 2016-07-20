/**
 * Created by zJJ on 7/20/2016.
 */

module.exports = function (app) {
  var modelNames = Object.keys(app.models);
  var models = [];
  modelNames.forEach(function (m) {
    var modelName = app.models[m].modelName;
    if (models.indexOf(modelName) === -1) {
      models.push(modelName);
    }
  });
  console.log('> Models:\n', models);
};

