'use strict'
import from 'es6-shim'
import assert from 'assert'
import mongoose from 'mongoose'
import {EventEmitter} from 'events'

const {Schema: {Types: {Mixed}}, Types: {ObjectId}} = mongoose

//------------------------------------------------------------------------------
const AclPath = 'acl'
const AclScopeName = 'acl'

// Array#from whould be used when it will be provided by node
function set2array(s){
  let arr = []
  for(let i of s.keys()) arr.push(i)
  return arr
}

//------------------------------------------------------------------------------
function toSetOfGrantees(v){
  v = v || new Set()
  v = v.grantees ? v.grantees : v

  if(Array.isArray(v)){
    return new Set(v)
  }

  if(v instanceof Set){
    return v
  }

  return new Set().add(v)
}


//------------------------------------------------------------------------------
function isMatchingGrant(scope, grantees){
  grantees = toSetOfGrantees(grantees)
  return function(v){
    return grantees.has(v.grantee) && v.scope == scope
  }
}

//------------------------------------------------------------------------------
class AclWriter extends EventEmitter{

  //-------------------------
  constructor(doc, tag, opts){
    this.doc = doc
    this.tag = tag
    this.opts = opts
  }

  //-------------------------
  scope(scopeName){
    assert.ok(scopeName, 'Scope must be defined')
    if(!this.opts.scopes.find(v => v.name == scopeName)){
      throw new Error(`Invalid scope <${scopeName}> provided`)
    }
    this.currentScope = scopeName
    return this
  }

  //-------------------------
  scopes(){
    return this.opts.scopes.map(v => v.name)
  }

  //-------------------------
  tags(){
    return this.doc[this.opts.path].tags.map(v => v.name)
  }
  //-------------------------
  access(grantees){
    assert.ok(this.currentScope, 'Scope is not selected')
    grantees = toSetOfGrantees(grantees)

    return this.tag.grants
      .filter(isMatchingGrant(this.currentScope, grantees))
      .reduce((o, v) => o < v.permission ? v.permission : o, this.opts.lowestAccess)
  }

  //-------------------------
  end(){
    return this
  }

    //-------------------------
  grantAccess(grantees, permission){
    if(permission == null){
      permission = grantees
      grantees = this.doc[this.opts.path].grants
        .filter(v => v.scope === this.currentScope)
        .map(v => v.grantee)
    }

    assert.ok(grantees, 'Grantees must be defined')
    assert.ok(permission >= this.opts.lowestAccess, 'Invalid permission level')

    grantees = toSetOfGrantees(grantees)
    for(let grantee of grantees){
      let grant = this.tag.grants.find(isMatchingGrant(this.currentScope, grantee))

      if(!grant){
        grant = {
          id: new ObjectId(),
          grantee: grantee,
          permission: permission,
          scope: this.currentScope
        }

        this.tag.grants.push(grant)
        this.markModified()
      }

      if(grant.permission != permission){
        grant.permission = permission
        this.markModified()
      }
    }
    return this
  }

  //-------------------------
  denyAccess(grantees){
    return this.grantAccess(grantees, this.opts.lowestAccess)
  }

  //-------------------------
  apply(){
    if(!this.doc.isModified(this.opts.path)){
      return this.doc
    }

    let acl = this.doc[this.opts.path]

    let map = new Map()
    for(let tag of acl.tags){
      for(let grant of tag.grants){
        let key = `${grant.scope}:${grant.grantee}`
        map.set(key, grant.permission)
      }
    }

    acl.grants = []
    for(let [k, p] of map.entries()){
      let [scope, grantee] = k.split(':')
      acl.grants.push({
        id: new ObjectId(),
        scope: scope,
        grantee: grantee,
        permission: p
      })
    }

    if(map.size) this.markModified()
    return this.doc
  }

  //-------------------------
  reject(){
    let acl = this.doc[this.opts.path]
    acl.tags = acl.tags.filter(v => v !== this.tag)
    this.markModified()
    return this
  }

  //-------------------------
  markModified(){
    this.doc.markModified(this.opts.path)
    this.emit('modify')
  }
}

//------------------------------------------------------------------------------
function getAcl(opts, tagName){
  'use strict'
  assert.ok(this.isSelected(opts.path), 'Acl must be selected')

  const acl = !this[opts.path]
    ? this[opts.path] = {tags: [], grants: []}
    : this[opts.path]

  if(tagName){
    if(!acl.tags.find(v => v.name == tagName)){
      acl.tags.push({name: tagName, grants: []})
    }
  }

  let tag = tagName
    ? acl.tags.find(v => v.name == tagName)
    : acl

  return new AclWriter(this, tag, opts)
}


//------------------------------------------------------------------------------
function findAccessibleBy(opts, grantees, permission, scope, selectAclScope = true){
  assert.ok(permission >= opts.lowestAccess, 'Invalid permission level')
  assert.ok(scope, 'Scope must be defined')

  grantees = toSetOfGrantees(grantees)

  let q = this.where(`${opts.path}.grants`).elemMatch({
    scope      : scope,
    grantee    : {$in: set2array(grantees)},
    permission : {$gte: permission}
  })

  return selectAclScope
    ? q.select(this.select('acl'))
    : q
}


//------------------------------------------------------------------------------
function explainAcl(opts, grantees){
  grantees = toSetOfGrantees(grantees)

  let acl = this.getAcl()
  return acl.scopes().reduce(function(o, scope){
    o[scope] = acl.scope(scope).access(grantees)
    return o
  }, {})
}

//------------------------------------------------------------------------------
function selectList(opts, ...scopes){
  'use strict'
  scopes = new Set(scopes)
  return set2array(
    opts.scopes
      .filter(v => scopes.has(v.name))
      .reduce((o, v) => v.paths.reduce((o, v) => o.add(v), o), new Set())
      .add(opts.path)
  )
}

//------------------------------------------------------------------------------
export default function plugin(sch, opts){
  opts.path = opts.path || AclPath
  opts.scopes = opts.scopes.filter(v => v.name != AclScopeName)
  opts.scopes.push({name: AclScopeName, paths: [AclPath]})
  opts.lowestAccess = opts.lowestAccess != null
    ? opts.lowestAccess
    : 0

  // В качестве временного решения запрещаем размещять ACL на вложенных полях
  // модели.
  assert.ok(opts.path.search(/\./) == -1)

  sch.path(opts.path, Mixed)
  sch.index({
    [`${opts.path}.grants.scope`]: 1,
    [`${opts.path}.grants.grantee`]: 1,
    [`${opts.path}.grants.permission`]: 1
  })

  sch.statics.__plugin_acl_enabled__ = true
  sch.statics.aclPath = opts.path

  sch.statics.select = function (...scopes){
    return this.selectList(...scopes).join(' ')
  }

  sch.statics.selectList = function (...scopes){
    return selectList.apply(this, [opts, ...scopes])
  }

  sch.statics.findAccessibleBy = function(grantees, permission, scope, selectAclScope){
    return findAccessibleBy.call(this, opts, grantees, permission, scope, selectAclScope)
  }

  sch.methods.explainAcl = function(grantees){
    return explainAcl.call(this, opts, grantees)
  }

  sch.methods.getAcl = function (tagName){
    return getAcl.call(this, opts, tagName)
  }
}
