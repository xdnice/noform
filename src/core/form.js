import AsyncValidator from 'async-validator';
import EventEmitter from 'events';
import { VALUE_CHANGE, CHANGE, ANY_CHANGE, BASIC_EVENT, INITIALIZED } from '../static';
import ItemCore from './item';

// 工具方法
const isObject = obj => Object.prototype.toString.call(obj) === '[object Object]';
const genName = () => `__anonymouse__${Math.random().toString(36)}`;
const noop = () => {};
const isInvalidVal = val => (typeof val === 'number' ? false : !val);
const isSingleItemSet = arg => (arg.length >= 3 && typeof arg[1] === 'string');

class Form {
    constructor(option = {}) {
        const {
            validateConfig, onChange, value, values, status, globalStatus, interceptor, uniqueId,
            initialized,
            autoValidate,
        } = option || {};

        this.onChange = onChange || noop;
        this.children = [];
        this.childrenMap = {};
        this.currentEventType = 'api';
        this.autoValidate = autoValidate || false;

        this.globalStatus = globalStatus || 'edit';

        // 基础属性
        this.value = values || value || {};
        this.status = isObject(status) ? status : {}; // 避免jsx传入单值status
        this.props = {};
        this.error = {};

        this.interceptor = interceptor || {}; // 拦截器
        this.validateConfig = validateConfig;

        this.id = uniqueId || `__noform__${Math.random().toString(36)}`;

        this.emitter = new EventEmitter();
        this.emitter.setMaxListeners(1000); // TODO: 最大值

        Array.from(['Value', 'Status', 'Error', 'Props']).forEach((name) => {
            // 多字段
            this[`set${name}`] = this.set.bind(this, name.toLowerCase());
            this[`get${name}`] = this.get.bind(this, name.toLowerCase());

            // 单字段
            this[`setItem${name}`] = this.setItem.bind(this, name.toLowerCase());
            this[`getItem${name}`] = this.get.bind(this, name.toLowerCase());
        });

        this.initialized = initialized || noop;

        // 别名
        this.setValues = this.setValue;
        this.getValues = this.getValue;

        // 处理item的setValue事件
        this.on(VALUE_CHANGE, this.handleChange);
        this.on(INITIALIZED, this.initialized);
    }

    // 上报change事件到JSX
    handleChange = (name) => {
        if (!this.silent && !this.hasEmitted) { // 变化的keys必须为数组
            const relatedKeys = this.settingBatchKeys || [name];
            if (this.autoValidate) { // 按需校验
                this.validateItem(relatedKeys);
            }

            this.onChange(relatedKeys, this.value, this);
            this.emit(CHANGE, this.value, relatedKeys, this);
        }

        if (this.silent) this.hasEmitted = false;
        if (this.isSetting) this.hasEmitted = true;
    }

    // 事件处理相关
    on(...args) { this.emitter.on(...args); }
    emit(...args) { this.emitter.emit(...args); }
    removeListener(...args) { this.emitter.removeListener(...args); }

    // 检验单项
    async validateItem(name, cb = x => x) {
        const arrName = [].concat(name);
        const validators = [];
        this.children.forEach((child) => {
            if (arrName.indexOf(child.name) !== -1) {
                validators.push(child.validate());
            }
        });

        this.validatng = true;
        const errs = await Promise.all(validators);
        this.validatng = false;
        const errors = {};
        const retErr = {};
        let hasError = false;

        this.children.forEach((child) => {
            if (child.name && arrName.indexOf(child.name) !== -1) {
                const idx = arrName.indexOf(child.name);

                if (errs[idx] && child.status !== 'hidden') {
                    hasError = true;
                    retErr[child.name] = errs[idx];
                }
                if (child.status === 'hidden') {
                    errors[child.name] = null;
                } else {
                    errors[child.name] = errs[idx] || null;
                }
            }
        });

        this.setError(errors);
        if (!hasError) {
            return cb(null);
        }
        return cb(retErr);
    }
    validateAll = (cb = x => x) => { // 纯净的校验方法, ui无关，不会涉及页面error 展示
        const validator = new AsyncValidator(this.validateConfig);
        let walked = false;
        let errors = null;
        console.log('valll');
        const prom = new Promise((resolve) => {
            validator.validate(this.value, (err) => {
                errors = err ? err[0].message : errors;
                walked = true;
                resolve(errors);
            });
        });

        if (walked) {
            return cb(errors);
        }
        return prom.then(errs => cb(errs));
    }

    // 表单校验,返回错误对象
    validateBase(cb, withRender) {
        const validators = [];
        let hasPromise = false;
        this.validatng = true;
        this.children.forEach((child) => {
            const result = child.validate();
            if (result instanceof Promise) {
                hasPromise = true;
            }
            validators.push(result);
        });
        if (hasPromise) {
            return Promise.all(validators).then(this.handleErrors).then(cb);
        }
        this.validatng = false;
        return cb(this.handleErrors(validators, withRender));
    }

    validateWithoutRender(cb) {
        return this.validateBase(cb, false);
    }
    // 表单校验,返回错误对象
    validate(cb = x => x) {
        return this.validateBase(cb, true);
    }

    handleErrors = (errs, WithRender) => {
        const errors = {};
        const retErr = {};
        let hasError = false;
        this.validatng = false;

        this.children.forEach((child, idx) => {
            if (errs[idx] && child.status !== 'hidden') {
                hasError = true;
                retErr[child.name] = errs[idx];
            }
            if (child.status === 'hidden') {
                errors[child.name] = null;
            } else {
                errors[child.name] = errs[idx] || null;
            }
        });
        if (WithRender) {
            this.setError(errors);
        }
        if (!hasError) {
            return null;
        }
        return retErr;
    }
    // 静默设值
    setValueSilent(...args) {
        this.silent = true;
        this.set('value', ...args);
        this.silent = false;
    }

    // 设置单子段
    setItem(type, name, value) {
        this.isSetting = true;
        let formatValue = value;

        // 处理props的情况，merge合并
        if (type === 'props') {
            const lastProps = this[type][name] || {};
            formatValue = value || {};
            formatValue = {
                ...lastProps,
                ...formatValue,
            };
        }

        this[type][name] = formatValue;
        const targetItem = this.children.find(child => child.name === name);
        if (targetItem) targetItem.set(type, formatValue);

        if (type === 'value') { // 处理不在childNames里的值
            const childNames = this.children.map(child => child.name);
            if (childNames.indexOf(name) === -1) {
                this.emit(BASIC_EVENT[type], name, formatValue);
                this.emit(ANY_CHANGE, type, name, formatValue);
            }
        }

        this.isSetting = false;
        this.hasEmitted = false;
    }

    // 重置value
    reset(keys) {
        const emptyValue = {};
        const resetKeys = keys || Object.keys(this.value);
        resetKeys.forEach((key) => {
            emptyValue[key] = null;
        });

        this.setValue(emptyValue);
    }

    // 设置多字段
    set(type, value) {
        // 设置单字段
        if (isSingleItemSet(arguments)) {
            this.setItem(type, value, arguments[2]);
            return;
        }

        if (type === 'status' && typeof value === 'string') {
            this.setGlobalStatus(value);
            return;
        }

        this.isSetting = true;

        // 异常情况
        if (typeof value !== 'object') {
            this.isSetting = false;
            this.hasEmitted = false;
            return;
        }

        // 处理props的情况，merge合并
        let formatValue = value;
        if (type === 'props') {
            formatValue = value || {};
            Object.keys(formatValue).forEach((propsKey) => {
                const targetProps = formatValue[propsKey] || {};
                const lastProps = this[type][propsKey] || {};

                formatValue[propsKey] = {
                    ...lastProps,
                    ...targetProps,
                };
            });
        }

        this[type] = {
            ...this[type],
            ...formatValue,
        };

        if (type === 'value') {
            this.settingBatchKeys = Object.keys(value); // 批量变化的值
        }

        const childNames = [];
        this.children.forEach((child) => {
            child.set(type, this[type][child.name]);
            childNames.push(child.name);
        });

        if (type === 'value') { // 处理不在childNames里的值
            if (Array.isArray(this.settingBatchKeys)) {
                this.settingBatchKeys.forEach((setKey) => {
                    if (childNames.indexOf(setKey) === -1) {
                        this.emit(BASIC_EVENT[type], setKey, this[type][setKey]);
                        this.emit(ANY_CHANGE, type, setKey, this[type][setKey]);
                    }
                });
            }
        }

        this.isSetting = false;
        this.hasEmitted = false;
        this.settingBatchKeys = null;
    }

    // 全局状态
    setGlobalStatus(targetStatus) {
        if (this.globalStatus === targetStatus) {
            return this;
        }
        this.globalStatus = targetStatus;
        const status = {};
        this.children.forEach((child) => {
            status[child.name] = targetStatus;
        });
        return this.setStatus(status);
    }

    getGlobalStatus() {
        return this.globalStatus;
    }

    // 获取多值
    getAll(type, name) {
        if (name) {
            return this[type][name];
        }
        return this[type];
    }

    // 获取值
    get(type, name) {
        if (name) {
            return this[type][name];
        }
        let ret = this.filter(this.getAll(type));
        if (type === 'error') {
            let hasError = false;
            Object.keys(ret).forEach((key) => {
                if (ret[key]) {
                    hasError = true;
                }
            });

            if (!hasError) ret = null;
        }
        return ret;
    }

    filter(obj) {
        if (!isObject(obj)) {
            return obj;
        }

        const ret = {};
        Object.keys(obj).forEach((key) => {
            if (key.indexOf('__anonymouse__') !== 0 && this.get('status', key) !== 'hidden') {
                ret[key] = this.filter(obj[key]);
            }
        });

        return ret;
    }

    addField(fieldProps) {
        // 处理非数组情况，考虑null,undefined
        if (!Array.isArray(fieldProps)) {
            // eslint-disable-next-line
            fieldProps = [fieldProps];
        }

        const ret = fieldProps.map((option) => {
            const mrOption = Object.assign({}, option);
            const {
                value, name, status, error, props, func_status,
                interceptor: localInterceptor,
            } = option;

            if (this.childrenMap[name]) {
                return this.childrenMap[name];
            }

            // name特殊处理
            if (typeof name === 'number') mrOption.name = `${name}`;
            if (!name) mrOption.name = genName();

            // JSX 属性 > core默认值 > 默认属性(globalStatus) > 空值
            mrOption.jsx_status = status || func_status;
            mrOption.value = isInvalidVal(value) ? (this.value[name] || null) : value;
            this.value[mrOption.name] = mrOption.value;
            // eslint-disable-next-line
            this.status[mrOption.name] = mrOption.status = status || this.status[name] || this.globalStatus;
            this.props[mrOption.name] = mrOption.props = props || {};
            this.error[mrOption.name] = mrOption.error = error || null;

            const item = new ItemCore({
                ...mrOption,
                on: this.on.bind(this),
                emit: this.emit.bind(this),
                removeListener: this.removeListener.bind(this),
                interceptor: localInterceptor || this.interceptor[mrOption.name],
                form: this,
            });

            this.childrenMap[item.name] = item;
            this.children.push(item);
            return item;
        });
        if (ret.length === 1) {
            return ret[0];
        }
        return ret;
    }

    updateField(props) {
        if (!Array.isArray(props)) {
            // eslint-disable-next-line
            props = [props];
        }
        props.forEach((option) => {
            if (!option.name) {
                throw Error('updateField must specify name');
            }
            this.childrenMap[option.name].updateField(option);
        });
    }

    setValidateConfig(config) {
        if (isObject(config)) {
            this.validateConfig = config;
            this.children.forEach((child) => {
                if (child.name in config) {
                    child.setValidateConfig(config[child.name]);
                }
            });
        }
    }
}


export default Form;
