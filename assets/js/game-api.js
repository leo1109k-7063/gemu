/**
 * game-api.js
 * Supabase 연동 및 게임 데이터(학습 기록, 퀴즈, 코인) 관리 API
 */

// Supabase 클라이언트가 이미 전역에 선언되어 있다고 가정합니다.
// (예: const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);)

const GameAPI = {
  /**
   * 현재 로그인된 사용자의 프로필 정보(코인 잔액 포함)를 가져옵니다.
   * @returns {Promise<Object|null>} 프로필 데이터 또는 null
   */
  async getProfile() {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        console.warn('로그인된 사용자가 없습니다.');
        return null;
      }

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (error) {
        console.error('프로필 조회 실패:', error.message);
        return null;
      }

      return data;
    } catch (err) {
      console.error('getProfile 예외 발생:', err);
      return null;
    }
  },

  /**
   * 학습 완료 기록을 저장합니다.
   * @param {string} contentId - 학습 콘텐츠 고유 ID
   */
  async recordLearning(contentId) {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        throw new Error('로그인이 필요합니다.');
      }

      const { data, error } = await supabase
        .from('learning_records')
        .insert([
          { user_id: user.id, content_id: contentId, status: 'completed' }
        ]);

      if (error) {
        throw error;
      }

      console.log('학습 기록 저장 성공:', contentId);
      return { success: true, data };
    } catch (err) {
      console.error('학습 기록 저장 실패:', err.message);
      return { success: false, error: err.message };
    }
  },

  /**
   * 퀴즈 결과를 제출합니다. 
   * 정답(isCorrect = true)인 경우 자동으로 서버 측에서 3코인이 지급됩니다.
   * @param {string} quizId - 퀴즈 고유 ID
   * @param {boolean} isCorrect - 정답 여부 (true / false)
   */
  async submitQuiz(quizId, isCorrect) {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        throw new Error('로그인이 필요합니다.');
      }

      // Supabase RPC 함수 호출 (서버 단에서 안전하게 코인 지급 및 기록 처리)
      const { data, error } = await supabase.rpc('submit_quiz_result', {
        p_quiz_id: quizId,
        p_is_correct: isCorrect
      });

      if (error) {
        throw error;
      }

      console.log(`퀴즈 제출 완료 (정답 여부: ${isCorrect})`);
      
      // 최신 프로필 정보(갱신된 코인 잔액 등)를 다시 조회하여 반환
      const updatedProfile = await this.getProfile();

      return { 
        success: true, 
        isCorrect, 
        rewardEarned: isCorrect ? 3 : 0,
        profile: updatedProfile 
      };
    } catch (err) {
      console.error('퀴즈 제출 실패:', err.message);
      return { success: false, error: err.message };
    }
  },

  /**
   * 사용자의 퀴즈 풀이 기록 목록을 가져옵니다.
   */
  async getQuizRecords() {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) return [];

      const { data, error } = await supabase
        .from('quiz_records')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data;
    } catch (err) {
      console.error('퀴즈 기록 조회 실패:', err.message);
      return [];
    }
  },

  /**
   * 사용자의 학습 기록 목록을 가져옵니다.
   */
  async getLearningRecords() {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) return [];

      const { data, error } = await supabase
        .from('learning_records')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data;
    } catch (err) {
      console.error('학습 기록 조회 실패:', err.message);
      return [];
    }
  }
};

// 전역 객체로 등록 (필요시 사용)
window.GameAPI = GameAPI;
