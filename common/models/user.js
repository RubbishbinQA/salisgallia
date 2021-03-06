/**
 * Created by zJJ on 7/20/2016.
 */
var speakeasy = require("speakeasy"),
  _ = require("lodash"),
  salt = "moc43viv8ipum",
  https = require("https"),
  _crypto = require("crypto"),
  loopback = require("loopback"),
  promise = require("promise"),
  profile_pic = require("../logic/s3profile"),
  db = require("../../common/util/db.js"),
  logTag = "> user.js",
  result_bool = {
    acknowledged: true
  };

var pwdassign = function (token) {
  return _crypto.createHmac("md5", salt)
    .update(token)
    .digest("hex");
};

var check_date_expired = function (expire_time) {
  if (!_.isEmpty(expire_time)) {
    var date = new Date(expire_time);
    var now = new Date();
    if (date.parse() >= now.parse()) {
      console.log("> login =====================");
      console.log("This token is expired.");
      return true;
    } else {
      return false;
    }
  } else
    return false;
};
module.exports = function (user) {
  user.disableRemoteMethodByName("createChangeStream");
  user.disableRemoteMethodByName("patchOrCreate");
  user.disableRemoteMethodByName("replaceOrCreate");
  user.disableRemoteMethodByName("replaceById");
  user.disableRemoteMethodByName("upsertWithWhere");
  var change_password = function (user_id, new_password, callback_normal) {
    db.updateByIdUpdate(user, user_id, {
      "recovery_code": -1,
      "password": new_password
    }, function (err, ur) {
      callback_normal(err);
    });
  };


  /*
   user.validatesPresenceOf("name", "email")
   user.validatesLengthOf("password", {min: 5, message: {min: "Password is too short"}});
   user.validatesInclusionOf("gender", {in: ["male", "female"]});
   user.validatesExclusionOf("domain", {in: ["www", "billing", "admin"]});
   user.validatesNumericalityOf("age", {int: true});
   */
  user.validatesLengthOf("password", {min: 5, message: {min: "Password is too short"}});
  user.validatesUniquenessOf("email", {message: "email is not unique"});
  user.email_verify_from_code = function (credentials, cb) {
    if (_.isEmpty(credentials)) {
      cb(new Error("data not correct 1"), null);
      return;
    }
    if (_.isEmpty(credentials.email) || _.isEmpty(credentials.code) || _.isEmpty(credentials.newpwd)) {
      cb(new Error("data not correct 2"), null);
      return;
    }
    if (parseInt(credentials.code) < 1) {
      cb(new Error("Activation code is not correct"), null);
      return;
    }
    user.findOne({
      where: {
        "email": credentials.email,
        "recovery_code": credentials.code
      }
    }, function (err, r) {
      if (_.isError(err)) {
        cb(err, null);
        return;
      }

      if (_.isEmpty(r)) {
        cb(new Error("incorrect code"), null);
        return;
      }
      console.log("found user: ", r);
      change_password(r.id, credentials.newpwd, function (err) {
        if (_.isError(err)) {
          console.log("> =======================================================");
          console.log("> Error from changing password with normal login", err);
          console.log("> =======================================================");
          cb(err, null);
          return;
        }
        cb(null, result_bool);
      });
    });
  };


  user.most_popular = function (cb) {
    user.find({
      where: {},
      order: "uploads DESC",
      limit: 5
    }, function (err, list) {
      if (_.isError(err)) {
        cb(err, null);
        return;
      }
      console.log(logTag, list);
      cb(null, list);
    });
  };

  user.email_verify = function (credentials, cb) {
    if (_.isEmpty(credentials)) {
      cb(new Error("data not correct 1"), null);
      return;
    }
    if (_.isEmpty(credentials.email)) {
      cb(new Error("data not correct 2"), null);
      return;
    }

    var code = speakeasy.totp({secret: "APP_SECRET" + credentials.email});
    console.log("Two factor code for " + credentials.email + ": " + code);
    //var renderer = loopback.template(path.resolve(__dirname, "../../common/views/email-template.ejs"));
    //html_body = renderer(myMessage);
    var message = "Your account email and verification code are listed below:";
    message += "\n " + credentials.email;
    message += "\nEnter this code on the screen to reset your password.";
    message += "\n " + code;
    message += "\n=============";
    message += "\n您的帐户电子邮件和验证码列: ";
    message += "\n" + credentials.email;
    message += "\n输入屏幕上的验证码重置您的密码。";
    message += "\n" + code;
    message += "\n=============";

    user.findOne({
      where: {
        "email": credentials.email
      }
    }, function (err, r) {
      if (_.isError(err)) {
        cb(err, null);
        return;
      }

      if (_.isEmpty(r)) {
        cb(new Error("incorrect email"), null);
        return;
      }
      /**
       * step2
       */

      var data_confirmation = {
        to: credentials.email,
        from: "no-reply@zyntario.com",
        subject: "Password recovery for missing account.",
        text: message,
        html: ""
      };

      user.app.models.Email.send(data_confirmation,
        function (err, mail) {
          console.log("Email Sent!");

          if (_.isError(err)) {
            cb(err, null);
            return;
          }

          console.log(mail);

          if (mail != null) {
            db.updateByIdUpdate(user, r.id, {
              "recovery_code": code
            }, function (doc) {
              cb(null, result_bool);
            });
          }
        }
      );
      /**
       * update
       */
    });


  };


  user.requestCode = function (credentials, fn) {
    this.findOne({where: {email: credentials.email}}, function (err, user) {
      user.hasPassword(credentials.password, function (err, isMatch) {
        if (isMatch) {
          // Note that you"ll want to change the secret to something a lot more secure!
          var code = speakeasy.totp({secret: "APP_SECRET" + credentials.email});
          console.log("Two factor code for " + credentials.email + ": " + code);

          // [TODO] hook into your favorite SMS API and send your user their code!

          https.get(
            "https://rest.nexmo.com" +
            "/sms/json?api_key=[YOUR_KEY]&amp;api_secret=[YOUR_SECRET]" +
            "&amp;from=[YOUR_NUMBER]&amp;to=[USER_MOBILE_#]" +
            "&amp;text=Your+verification+code+is+" + code,
            function () {
              res.on("data", function (data) {
                // all done! handle the data as you need to
                fn(null, data);
              });
            }
          ).on("error", function () {
            // handle errors somewhow
            console.log("Error in here from using nexmo");
            var err = new Error("Sorry, nexmo is having issue from making the sms request!");
            err.statusCode = 401;
            err.code = "LOGIN_FAILED";
            return fn(err);
          });

        } else {
          var err = new Error("Sorry, but that email and password do not match!");
          err.statusCode = 401;
          err.code = "LOGIN_FAILED";
          return fn(err);
        }
      });
    });
  };


  /**
   * input object consist of
   *
   * {
   *    email: xxxxx,
   *    twofactor: xxxx
   * }
   *
   * @param credentials
   * @param fn
   */
  user.loginWithCode = function (credentials, fn) {
    console.log("update", "loginWithCode");
    var err = new Error("Sorry, but that verification code does not work!");
    err.statusCode = 401;
    err.code = "LOGIN_FAILED";
    this.findOne({where: {email: credentials.email}}, function (err, user) {
      // And don"t forget to match this secret to the one in requestCode()
      var code = speakeasy.totp({secret: "APP_SECRET" + credentials.email});
      if (code !== credentials.twofactor) {
        return fn(err);
      }
      // Everything looks good, so now we can create the access token, which
      // is used for all future API calls to authenticate the user.
      user.createAccessToken(86400, function (err, token) {
        if (err) return fn(err);
        token.__data.user = user;
        fn(err, token);
      });
    });
  };
  user.update_meta_call = function (data, id, fn) {
    if (typeof data === "function") {
      // fn = include;
      data = undefined;
    }
    // console.log("update", "line1");
    /* var ctx = loopback.getCurrentContext();
     var accessToken = ctx.get("accessToken");
     var userid = accessToken.userId;*/
    //  var ojec = JSON.parse(data);
    //  console.log("update ojec", ojec);
    //console.log("update data", data);
    var err = new Error("Sorry, but that verification code does not work!");
    err.statusCode = 401;
    err.code = "LOGIN_FAILED";
    //  console.log("update", "line3");
    db.updateByIdUpdate(user, id, {
      "photo": data
    }, function (doc) {
      // console.log("update", "completed update and photo object");
      //fn(null, doc);
      // console.log("update", doc);
      fn(null, doc);
    });
  };
  user.fb_login_call = function (data, fn) {
    if (typeof data === "function") {
      data = undefined;
    }
    //console.log("> ==== :", data);
    var _url_ = data["photo"];
    var facebook_id = data["facebook.userid"];
    var email = data["facebook.email"];
    var facebook_token = data["facebook.token"];
    var facebook_expire = data["facebook.expire"];
    console.log("> ====================================");
    console.log("> Facebook login =====================");
    console.log("> ====================================");
    console.log("> ==== facebook expire is here");
    console.log("> ====>> :", facebook_expire);
    console.log("> ==== facebook user email here");
    console.log("> ====>> :", facebook_id);
    console.log("> ==== facebook user token here");
    console.log("> ====>> :", facebook_token);
    console.log("> ==== facebook url for photo");
    console.log("> ====>> :", _url_);
    user.findOne({
      where: {
        "facebook.userid": facebook_id
      }
    }, function (err, r) {
      if (_.isError(err)) {
        console.log("technical error from db", err);
        return;
      }
      if (_.isEmpty(r)) {
        console.log("> ==============================================");
        console.log("> Create new login account =====================");
        console.log("> ==============================================");
        user.create({
          "facebook": {
            "userid": facebook_id,
            "email": email,
            "token": facebook_token,
            "expire": facebook_expire
          },
          "email": email,
          "password": pwdassign(facebook_token)
        }, function (err, r) {
          if (_.isError(err)) {
            console.log("technical error from db", err);
          }
          user.login({email: email, password: pwdassign(facebook_token)},
            function (err, token) {
              console.log("> ==============================================");
              console.log("> ===========   Login Success    ===============");
              console.log("> ==============================================");
              console.log("The new user object is defined in here", r);
              console.log("You have just created a new account and log on to this account now and the token object is [", token, "]");
              console.log("> ==============================================");

              fn(null, r);
            });
        });

      } else {

        var user_id = r.id;

        console.log("> ============================================================================");
        console.log("> found existing user id from using the facebook user ID =====================");
        console.log("> The converted user Id from facebook = [", user_id, "]");
        console.log("> ============================================================================");

        if (_.isEmpty(user_id)) {
          console.log("> Login error because the converted user id is not found. ");
          return fn(new Error("Login error because the converted user id is not found"), null);
        }

        if (_.isEmpty(r.facebook)) {
          console.log("> facebook object is not found. ");
          return fn(new Error("Facebook object is not found"), null);
        }

        var __facebook = r.facebook;
        var __email = r.facebook.email;
        var __pwd = pwdassign(r.facebook.token);
        var __pwd_from_request = pwdassign(facebook_token);

        console.log("> =======================================================");
        console.log("> Review facebook object before login =======", r.facebook);
        console.log("> Review facebook email =======", __email);
        console.log("> Review facebook password =======", __pwd);
        console.log("> =======================================================");
        var bool_expired = check_date_expired(__facebook.expire);
        if (__facebook.token != facebook_token) {
          console.log("> =======================================================");
          console.log("> Found differ from the previous token now need to change a new password");
          console.log("> =======================================================");
          change_password(user_id, __pwd_from_request, function (err) {
            if (_.isError(err)) {
              console.log("> =======================================================");
              console.log("> Error from changing password", err);
              console.log("> =======================================================");
              return;
            }

            user.login({email: __email, password: __pwd_from_request},
              function (err, token) {

                if (_.isError(err)) {
                  console.log("technical error from login process", err);
                  return fn(err, null);
                }

                console.log("> ==================================================");
                console.log("> After login ======================================");
                console.log("> ==================================================");
                console.log("You have just logon and the user token = [", token, "]");
                console.log("> ==================================================");
                fn(null, token);
              });

          });
        } else {

          user.login({email: __email, password: __pwd},
            function (err, token) {

              if (_.isError(err)) {
                console.log("technical error from login process", err);
                return fn(err, null);
              }

              console.log("> ==================================================");
              console.log("> After login ======================================");
              console.log("> ==================================================");
              console.log("You have just logon and the user token = [", token, "]");
              console.log("> ==================================================");
              fn(null, token);
            });
        }

      }
    });
    console.log("update", "execute first faster line here");
  };
  var renamefiles = function (fileInfo, req, res) {
    var uuid = require('node-uuid');
    var origFilename = fileInfo.name;
    // optimisticly get the extension
    var parts = origFilename.split('.'),
      extension = parts[parts.length - 1];
    // Using a local timestamp + user id in the filename (you might want to change this)
    var newFilename1 = (new Date()).getTime() + '_' + uuid.v1() + '.' + extension;
    var newFilename2 = uuid.v1() + '.' + extension;
    return newFilename2;
  };
  /**
   * implementation for loopback 2.0
   * @param req content request
   * @param res the request item
   * @param user_id the string in user id
   * @param cb the callback next
   */
  user.update_profile_photo = function (req, res, user_id, cb) {
    var StorageContainer = user.app.models.Container;
    StorageContainer.getContainers(function (err, containers) {
      if (containers.some(function (e) {
          return e.name == user_id;
        })) {
        StorageContainer.upload(req, res, {
          container: user_id,
          getFilename: renamefiles
        }, function (err, result) {
          //  console.log("update", result);
          profile_pic.profile_upload_s3(result, user, cb);
        });
      } else {
        StorageContainer.createContainer({name: user_id}, function (err, c) {
          StorageContainer.upload(req, res, {
            container: c.name,
            getFilename: renamefiles
          }, function (err, result) {
            // console.log("create", result);
            profile_pic.profile_upload_s3(result, user, cb);
          });
        });
      }
    });
  };
  user.remoteMethod("email_verify_from_code", {
    description: ["Email verification with the code. "],
    accepts: [
      {arg: "data", type: "object", http: {source: "body"}, required: true, description: "facebook login document"}
    ],
    returns: {
      arg: "token", type: "object", root: true, description: "Return value"
    },
    http: {verb: "post", path: "/reset_code_verify"}
  });

  user.remoteMethod("requestCode", {
    description: ["Email verification with the code. "],
    accepts: [
      {arg: "data", type: "object", http: {source: "body"}, required: true, description: "facebook login document"}
    ],
    returns: {
      arg: "token", type: "object", root: true, description: "Return value"
    },
    http: {verb: "post", path: "/request_code"}
  });

  user.remoteMethod("email_verify", {
    description: ["Email verification. "],
    accepts: [
      {arg: "data", type: "object", http: {source: "body"}, required: true, description: "facebook login document"}
    ],
    returns: {
      arg: "token", type: "object", root: true, description: "Return value"
    },
    http: {verb: "post", path: "/reset_login_pass"}
  });
  user.remoteMethod("fb_login_call", {
    description: ["Update facebook login access channel in here.."],
    accepts: [
      {arg: "data", type: "object", http: {source: "body"}, required: true, description: "facebook login document"}
    ],
    returns: {
      arg: "token", type: "object", root: true, description: "Return value"
    },
    http: {verb: "post", path: "/login_facebook"}
  });
  user.remoteMethod("loginWithCode", {
    description: ["Using token to login the system directly."],
    accepts: [
      {
        arg: "data",
        type: "object",
        http: {source: "body"},
        required: true,
        description: "credential object consists of email and twofactor code"
      }
    ],
    returns: {
      arg: "token", type: "object", root: true, description: "Return value"
    },
    http: {verb: "post", path: "/direct_login"}
  });
  user.remoteMethod(
    "most_popular", {
      description: ["List out the filter of popular artist in the community."],
      accepts: [],
      returns: {
        arg: "user", type: "object", root: true, description: "Return value"
      },
      http: {verb: "get", path: "/most_popular"}
    }
  );
  user.remoteMethod(
    "update_meta_call",
    {
      description: ["Update the data object from the object."],
      accepts: [
        {arg: "data", type: "object", http: {source: "body"}, required: true, description: "document in json"},
        {arg: "id", type: "string", http: {source: "path"}, required: true, description: "id"}
      ],
      returns: {
        arg: "user", type: "object", root: true, description: "Return value"
      },
      http: {verb: "post", path: "/:id/insertimagemeta"}
    }
  );
  user.remoteMethod(
    "update_profile_photo",
    {
      description: ["Update user profile in this api"],
      accepts: [
        {arg: 'req', type: 'object', 'http': {source: 'req'}},
        {arg: 'res', type: 'object', 'http': {source: 'res'}},
        {arg: 'id', type: 'string'}
      ],
      returns: {
        arg: "user", type: "object", root: true, description: "Return value"
      },
      http: {verb: "post", path: "/update_profile_photo/:id"}
    }
  );

  /*
   GetRcEscalation.remoteMethod(
   "getEscalations", {
   http: { verb: "get",path:"/getEscalations" },
   description: "Gets Escalation by the current user",
   accepts: { arg: "Id_Number", type: "number" },
   return: { arg: "data", type: ["GetRcEscalation"], root: true }
   });
   */

  user.afterRemote("create", function (context, user, next) {
    console.log("> user.afterRemote triggered");

    /*var options = {
     type: "email",
     to: user.email,
     from: "noreply@loopback.com",
     subject: "Thanks for registering.",
     template: path.resolve(__dirname, "../../server/views/verify.ejs"),
     redirect: "/verified",
     user: user
     };

     user.verify(options, function(err, response) {
     if (err) return next(err);

     console.log("> verification email sent:", response);

     context.res.render("response", {
     title: "Signed up successfully",
     content: "Please check your email and click on the verification link " +
     "before logging in.",
     redirectTo: "/",
     redirectToLinkText: "Log in"
     });
     });*/
    next();
  });

  //send password reset link when requested
  user.on("resetPasswordRequest", function (info) {
    var url = "http://" + config.host + ":" + config.port + "/reset-password";
    var html = 'Click <a href="' + url + '?access_token=' +
      info.accessToken.id + '">here</a> to reset your password';

    /*  user.app.models.Email.send({
     to: info.email,
     from: info.email,
     subject: 'Password reset',
     html: html
     }, function(err) {
     if (err) return console.log('> error sending password reset email');
     console.log('> sending password reset email to:', info.email);
     });*/

  });
};
/*http://stackoverflow.com/questions/14218925/how-can-i-decrypt-a-hmac

 Example on how encryption/decryption:
 const crypto = require("crypto");

 // key and iv
 var key = crypto.createHash("sha256").update("OMGCAT!", "ascii").digest();
 var iv = "1234567890123456";

 // this is the string we want to encrypt/decrypt
 var secret = "ermagherd";

 console.log("Initial: %s", secret);

 // create a aes256 cipher based on our password
 var cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
 // update the cipher with our secret string
 cipher.update(secret, "ascii");
 // save the encryption as base64-encoded
 var encrypted = cipher.final("base64");

 console.log("Encrypted: %s", encrypted);

 // create a aes267 decipher based on our password
 var decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
 // update the decipher with our encrypted string
 decipher.update(encrypted, "base64");

 console.log("Decrypted: %s", decipher.final("ascii"));

 */
