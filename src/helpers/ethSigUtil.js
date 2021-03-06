import ethAbi from "ethereumjs-abi";
import ethUtil from "ethereumjs-util";

const TYPED_MESSAGE_SCHEMA = {
  type: "object",
  properties: {
    types: {
      type: "object",
      additionalProperties: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            type: { type: "string" }
          },
          required: ["name", "type"]
        }
      }
    },
    primaryType: { type: "string" },
    domain: { type: "object" },
    message: { type: "object" }
  },
  required: ["types", "primaryType", "domain", "message"]
};

/**
 * A collection of utility functions used for signing typed data
 */
export const TypedDataUtils = {
  /**
   * Encodes an object by encoding and concatenating each of its members
   *
   * @param {string} primaryType - Root type
   * @param {Object} data - Object to encode
   * @param {Object} types - Type definitions
   * @returns {string} - Encoded representation of an object
   */
  encodeData(primaryType, data, types) {
    const encodedTypes = ["bytes32"];
    const encodedValues = [this.hashType(primaryType, types)];

    for (const field of types[primaryType]) {
      let value = data[field.name];
      if (value !== undefined) {
        if (field.type === "string" || field.type === "bytes") {
          encodedTypes.push("bytes32");
          value = ethUtil.sha3(value);
          encodedValues.push(value);
        } else if (types[field.type] !== undefined) {
          encodedTypes.push("bytes32");
          value = ethUtil.sha3(this.encodeData(field.type, value, types));
          encodedValues.push(value);
        } else if (field.type.lastIndexOf("]") === field.type.length - 1) {
          throw new Error("Arrays currently unimplemented in encodeData");
        } else {
          encodedTypes.push(field.type);
          encodedValues.push(value);
        }
      }
    }

    return ethAbi.rawEncode(encodedTypes, encodedValues);
  },

  /**
   * Encodes the type of an object by encoding a comma delimited list of its members
   *
   * @param {string} primaryType - Root type to encode
   * @param {Object} types - Type definitions
   * @returns {string} - Encoded representation of the type of an object
   */
  encodeType(primaryType, types) {
    let result = "";
    let deps = this.findTypeDependencies(primaryType, types).filter(
      dep => dep !== primaryType
    );
    deps = [primaryType].concat(deps.sort());
    for (const type of deps) {
      const children = types[type];
      if (!children) {
        throw new Error(`No type definition specified: ${type}`);
      }
      result += `${type}(${types[type]
        .map(({ name, type }) => `${type} ${name}`)
        .join(",")})`;
    }
    return result;
  },

  /**
   * Finds all types within a type defintion object
   *
   * @param {string} primaryType - Root type
   * @param {Object} types - Type definitions
   * @param {Array} results - current set of accumulated types
   * @returns {Array} - Set of all types found in the type definition
   */
  findTypeDependencies(primaryType, types, results = []) {
    if (results.includes(primaryType) || types[primaryType] === undefined) {
      return results;
    }
    results.push(primaryType);
    for (const field of types[primaryType]) {
      for (const dep of this.findTypeDependencies(field.type, types, results)) {
        !results.includes(dep) && results.push(dep);
      }
    }
    return results;
  },

  /**
   * Hashes an object
   *
   * @param {string} primaryType - Root type
   * @param {Object} data - Object to hash
   * @param {Object} types - Type definitions
   * @returns {string} - Hash of an object
   */
  hashStruct(primaryType, data, types) {
    return ethUtil.sha3(this.encodeData(primaryType, data, types));
  },

  /**
   * Hashes the type of an object
   *
   * @param {string} primaryType - Root type to hash
   * @param {Object} types - Type definitions
   * @returns {string} - Hash of an object
   */
  hashType(primaryType, types) {
    return ethUtil.sha3(this.encodeType(primaryType, types));
  },

  /**
   * Removes properties from a message object that are not defined per EIP-712
   *
   * @param {Object} data - typed message object
   * @returns {Object} - typed message object with only allowed fields
   */
  sanitizeData(data) {
    const sanitizedData = {};
    for (const key in TYPED_MESSAGE_SCHEMA.properties) {
      data[key] && (sanitizedData[key] = data[key]);
    }
    return sanitizedData;
  },

  /**
   * Signs a typed message as per EIP-712 and returns its sha3 hash
   *
   * @param {Object} typedData - Types message data to sign
   * @returns {string} - sha3 hash of the resulting signed message
   */
  sign(typedData) {
    let sanitizedData = this.sanitizeData(typedData);
    const parts = [Buffer.from("1901", "hex")];
    parts.push(
      this.hashStruct("EIP712Domain", sanitizedData.domain, sanitizedData.types)
    );
    parts.push(
      this.hashStruct(
        sanitizedData.primaryType,
        sanitizedData.message,
        sanitizedData.types
      )
    );
    return ethUtil.sha3(Buffer.concat(parts));
  }
};

/**
 * @desc convert string to buffer
 * @param  {String} value
 * @return {String}
 */
export const toBuffer = value => ethUtil.toBuffer(value);

/**
 * @desc convert buffer to hex
 * @param  {Object} buffer
 * @return {string}
 */
export const bufferToHex = buffer => ethUtil.bufferToHex(buffer);

/**
 * @desc separate signature params
 * @param  {String} sig
 * @return {Object}
 */
export const fromRpcSig = sig => {
  const signature = ethUtil.toBuffer(sig);
  const sigParams = ethUtil.fromRpcSig(signature);
  return sigParams;
};

/**
 * @desc ecrecover personal sign
 * @param  {String} msg
 * @param  {String} sig
 * @return {String}
 */
export const ecrecover = (msg, sig) => {
  const message = toBuffer(msg);
  const msgHash = ethUtil.hashPersonalMessage(message);
  const sigParams = fromRpcSig(sig);
  const publicKey = ethUtil.ecrecover(
    msgHash,
    sigParams.v,
    sigParams.r,
    sigParams.s
  );
  const sender = ethUtil.publicToAddress(publicKey);
  const senderHex = bufferToHex(sender);
  return senderHex;
};

export const concatSig = (v, r, s) => {
  const rSig = ethUtil.fromSigned(r);
  const sSig = ethUtil.fromSigned(s);
  const vSig = ethUtil.bufferToInt(v);
  const rStr = padWithZeroes(ethUtil.toUnsigned(rSig).toString("hex"), 64);
  const sStr = padWithZeroes(ethUtil.toUnsigned(sSig).toString("hex"), 64);
  const vStr = ethUtil.stripHexPrefix(ethUtil.intToHex(vSig));
  return ethUtil.addHexPrefix(rStr.concat(sStr, vStr)).toString("hex");
};

export const normalize = input => {
  if (!input) return;

  if (typeof input === "number") {
    const buffer = ethUtil.toBuffer(input);
    input = ethUtil.bufferToHex(buffer);
  }

  if (typeof input !== "string") {
    var msg = "eth-sig-util.normalize() requires hex string or integer input.";
    msg += " received " + typeof input + ": " + input;
    throw new Error(msg);
  }

  return ethUtil.addHexPrefix(input.toLowerCase());
};

export const personalSign = (privateKey, msgParams) => {
  var message = ethUtil.toBuffer(msgParams.data);
  var msgHash = ethUtil.hashPersonalMessage(message);
  var sig = ethUtil.ecsign(msgHash, privateKey);
  var serialized = ethUtil.bufferToHex(this.concatSig(sig.v, sig.r, sig.s));
  return serialized;
};

export const recoverPersonalSignature = msgParams => {
  const publicKey = getPublicKeyFor(msgParams);
  const sender = ethUtil.publicToAddress(publicKey);
  const senderHex = ethUtil.bufferToHex(sender);
  return senderHex;
};

export const extractPublicKey = msgParams => {
  const publicKey = getPublicKeyFor(msgParams);
  return "0x" + publicKey.toString("hex");
};

export const typedSignatureHash = typedData => {
  const hashBuffer = typedSignatureHashBuffer(typedData);
  return ethUtil.bufferToHex(hashBuffer);
};

export const signTypedDataLegacy = (privateKey, msgParams) => {
  const msgHash = typedSignatureHashBuffer(msgParams.data);
  const sig = ethUtil.ecsign(msgHash, privateKey);
  return ethUtil.bufferToHex(this.concatSig(sig.v, sig.r, sig.s));
};

export const recoverTypedSignatureLegacy = msgParams => {
  const msgHash = typedSignatureHashBuffer(msgParams.data);
  const publicKey = recoverPublicKey(msgHash, msgParams.sig);
  const sender = ethUtil.publicToAddress(publicKey);
  return ethUtil.bufferToHex(sender);
};

export const signTypedData = (privateKey, msgParams) => {
  const message = TypedDataUtils.sign(msgParams.data);
  const sig = ethUtil.ecsign(message, privateKey);
  return ethUtil.bufferToHex(this.concatSig(sig.v, sig.r, sig.s));
};

export const recoverTypedSignature = msgParams => {
  const message = TypedDataUtils.sign(msgParams.data);
  const publicKey = recoverPublicKey(message, msgParams.sig);
  const sender = ethUtil.publicToAddress(publicKey);
  return ethUtil.bufferToHex(sender);
};

/**
 * @param typedData - Array of data along with types, as per EIP712.
 * @returns Buffer
 */
export const typedSignatureHashBuffer = typedData => {
  const error = new Error("Expect argument to be non-empty array");
  if (typeof typedData !== "object" || !typedData.length) throw error;

  const data = typedData.map(e => {
    return e.type === "bytes" ? ethUtil.toBuffer(e.value) : e.value;
  });
  const types = typedData.map(e => {
    return e.type;
  });
  const schema = typedData.map(e => {
    if (!e.name) throw error;
    return e.type + " " + e.name;
  });

  return ethAbi.soliditySHA3(
    ["bytes32", "bytes32"],
    [
      ethAbi.soliditySHA3(new Array(typedData.length).fill("string"), schema),
      ethAbi.soliditySHA3(types, data)
    ]
  );
};

export const recoverPublicKey = (hash, sig) => {
  const signature = ethUtil.toBuffer(sig);
  const sigParams = ethUtil.fromRpcSig(signature);
  return ethUtil.ecrecover(hash, sigParams.v, sigParams.r, sigParams.s);
};

export const getPublicKeyFor = msgParams => {
  const message = ethUtil.toBuffer(msgParams.data);
  const msgHash = ethUtil.hashPersonalMessage(message);
  return recoverPublicKey(msgHash, msgParams.sig);
};

export const padWithZeroes = (number, length) => {
  var myString = "" + number;
  while (myString.length < length) {
    myString = "0" + myString;
  }
  return myString;
};
