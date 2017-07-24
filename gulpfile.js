var del        = require('del')
var gulp       = require('gulp')
var babel      = require('gulp-babel')
var ts         = require('gulp-typescript')

var babelOpts = {
  whitelist: [
    'es6.destructuring',
    'es6.parameters.default',
    'es6.parameters.rest',
    'es6.properties.computed',
    'es6.spread',
    'useStrict',
    'es6.classes',
    'es6.arrowFunctions',
    'es6.templateLiterals',
    'es6.modules'
  ],
  blacklist: [
    'es6.blockScoping',
    'es6.constants',
    'es6.forOf'
  ]
}

gulp.task('clean', function(cb){
  del(['build/*'], cb)
})

gulp.task('build', ['clean'], function(){
  var tsProject = ts.createProject('tsconfig.json')
  return tsProject.src()
    .pipe(tsProject())  
    .pipe(babel(babelOpts))
    .pipe(gulp.dest('lib'))
})

gulp.task('default', ['build'], function(){})
