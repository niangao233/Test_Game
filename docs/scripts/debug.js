
cat > docs/debug-permissions.js << 'EOF'
const { Octokit } = require('@octokit/rest');

async function debug() {
  console.log('=== 开始调试权限问题 ===');
  
  const token = process.env.GITHUB_TOKEN;
  console.log('1. 令牌存在:', !!token);
  console.log('2. 令牌前缀:', token ? token.substring(0, 10) + '...' : '无');
  
  const octokit = new Octokit({ auth: token });
  
  try {
    // 测试读取权限
    console.log('3. 测试读取仓库信息...');
    const repoInfo = await octokit.rest.repos.get({
      owner: 'niangao233',
      repo: 'Test_Game'
    });
    console.log('   ✅ 可以读取仓库');
    console.log('   仓库描述:', repoInfo.data.description || '无');
    
    // 测试Issues权限
    console.log('4. 测试列出Issues...');
    const issues = await octokit.rest.issues.listForRepo({
      owner: 'niangao233',
      repo: 'Test_Game',
      per_page: 1
    });
    console.log('   ✅ 可以读取Issues');
    console.log('   现有Issue数量:', issues.data.length);
    
    // 测试创建权限
    console.log('5. 测试创建Issue...');
    const testIssue = await octokit.rest.issues.create({
      owner: 'niangao233',
      repo: 'Test_Game',
      title: '权限测试 ' + new Date().toISOString(),
      body: '这是一个权限测试',
      labels: ['test']
    });
    console.log('   ✅ 可以创建Issue');
    console.log('   创建的Issue:', testIssue.data.number);
    console.log('   链接:', testIssue.data.html_url);
    
  } catch (error) {
    console.error('❌ 权限测试失败:');
    console.error('   状态码:', error.status);
    console.error('   错误信息:', error.message);
    console.error('   文档链接:', error.documentation_url);
    console.error('   完整错误:', JSON.stringify(error, null, 2));
  }
}

debug();