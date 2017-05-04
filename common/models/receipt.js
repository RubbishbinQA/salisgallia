/**
 * Created by hesk on 17年1月9日.
 */
"use strict";
const pre = require("../util/outputjson");
const _ = require('lodash');
const db_worker = require("./../util/db.js");
const stripe = require("stripe")(process.env.STRIPE_API_LIVE_SC || "");
module.exports = function (Receipt) {
  Receipt.disableRemoteMethodByName('create');
  Receipt.disableRemoteMethodByName('upsert');
  Receipt.disableRemoteMethodByName("updateAll");
  Receipt.disableRemoteMethodByName("deleteById");
  Receipt.disableRemoteMethodByName("updateAttributes");
  Receipt.disableRemoteMethodByName("createChangeStream");
  Receipt.disableRemoteMethodByName("patchOrCreate");
  Receipt.disableRemoteMethodByName("replaceOrCreate");
  Receipt.disableRemoteMethodByName("replaceById");
  Receipt.disableRemoteMethodByName("upsertWithWhere");
  // since setup is called for every extended model
  // the extended model will also have the event listener
  /*
   Receipt.setup = function () {
   var MyModel = this;
   Receipt.on('myEvent', function () {
   MyModel.printModelName();
   });
   };
   */

  function trycc(source_cc) {
    const city = source_cc.address_city == undefined ? "" : source_cc.address_city;
    const address_country = source_cc.address_country == undefined ? "" : source_cc.address_country;
    const address_line1 = source_cc.address_line1 == undefined ? "" : source_cc.address_line1;
    const address_line2 = source_cc.address_line2 == undefined ? "" : source_cc.address_line2;
    const address_state = source_cc.address_state == undefined ? "" : source_cc.address_state;
    const address_zip = source_cc.address_zip == undefined ? "" : source_cc.address_zip;

    return city + " " + address_country + " " + address_line1 + " " + address_line2 + " " + address_state + " " + address_zip;
  }

  Receipt.push_receipt = function (data, cb) {
    const event_json = data;
    const doc = event_json.data.object;
    console.log("> post receipt review");
    // console.log(data);
    const data_pack = {
      "source_network_id": event_json.request,
      "source_rec_id": doc.id == undefined ? "" : doc.id,
      "amount_in_cent": doc.amount,
      "currency_type": doc.currency,
      "customer_source_country": doc.source.country,
      "customer_source_address": trycc(doc.source),
      "customer_source_id": doc.source.id == undefined ? "" : doc.source.id,
      "customer_source_email": doc.receipt_email == undefined ? "" : doc.receipt_email,
      "is_live_mode": event_json.livemode,
      "createtime": doc.created
    };
    Receipt.create(data_pack, function (err, r) {
      if (_.isError(err)) {
        return cb(err);
      }
      const order = Receipt.app.models.Order;
      const Basemap = Receipt.app.models.Basemap;
      const source_n_id = r.source_rec_id;
      console.log("list of orders for seller ID");
      /**
       now we need to confirm the previous order and confirm those order has been filled.
       update user Id with the buyer Id
       **/
      order.updateAll(
        {source_network_id: source_n_id},
        {isOrderfilled: true},
        function (err, count) {
          if (err) {
            console.log("error", err);
          }
          console.log("> check receipt object", r);
          order.findOne({where: {source_network_id: source_n_id}}, function (err, order_info) {

            if (order_info == null) {
              console.log("> skip update buyer info of null found from order detail.");
              cb(null, pre.outAcknowledgePositive());
            } else {
              console.log("> check buyer Id now", order_info);
              Receipt.findById(r.id, function (err, ins_receipt) {
                if (err) {
                  console.log("error", err);
                } else {

                  Basemap.findOne({
                    id: order_info.stock_uuid
                  }, function (err, basemap_info) {

                    basemap_info.updateAttributes({"listing.sold_license": true}, function (err, count) {
                      if (err) {
                        console.log("error", err);
                      }
                      console.log("info sold license update.");
                    });
                  });

                  ins_receipt.updateAttributes({buyerId: order_info.buyerId}, function (err, count) {
                    if (err) {
                      console.log("error", err);
                    }
                    console.log("info buyer is updated.");
                    cb(null, pre.outAcknowledgePositive());
                  });

                }
              });
            }


          });
        });
    });
  };


  Receipt.remoteMethod("push_receipt", {
    description: ["Items are charged and full into the bank now."],
    accepts: [
      {arg: "data", type: "object", http: {source: "body"}, required: true, description: "item content to be posted"}
    ],
    returns: {
      arg: "ret", type: "object", root: true, description: "Return value"
    },
    http: {verb: "post", path: "/prp/"}
  });

  Receipt.observe('access', function (ctx, next) {
    if (!ctx.query.where) {
      ctx.query.where = {};
    }
    ctx.query.order = "updatetime DESC";
    next()
  });
};
